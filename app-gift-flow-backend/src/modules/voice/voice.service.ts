import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppError, badRequest, conflict } from '../../common/app-error';
import { AppConfig, CONFIG } from '../../config/config';
import { VoiceJob } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { EventsService } from '../events/events.service';
import { GiftsService } from '../gifts/gifts.service';
import { QuotasService } from '../quotas/quotas.service';
import { sniffAudioMime } from './audio-sniff';
import { VoiceSegmentDto } from './voice.dto';

export interface VoiceResponse {
  request_id: string;
  job_id: string;
  state: 'confirmed' | 'pending_review' | 'failed';
  transcript: string;
  candidate: { guest_name: string | null; relationship_label: string | null; amount_vnd: number | null };
  warnings: string[];
  duplicate_candidates: Array<{ gift_id: string; guest_name: string; amount_vnd: number }>;
}

@Injectable()
export class VoiceService {
  private readonly log = new Logger('Voice');

  constructor(
    @InjectRepository(VoiceJob) private readonly jobs: Repository<VoiceJob>,
    private readonly events: EventsService,
    private readonly gifts: GiftsService,
    private readonly ai: AiService,
    private readonly quotas: QuotasService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async processSegment(ownerId: string, dto: VoiceSegmentDto, file?: Express.Multer.File): Promise<VoiceResponse> {
    if (!file?.buffer?.length) throw badRequest('audio_required', 'Thiếu tệp audio');
    if (file.size > this.cfg.maxAudioBytes) throw new AppError(413, 'payload_too_large', 'Tệp âm thanh quá lớn');
    if (dto.duration_ms > this.cfg.maxAudioSeconds * 1000) {
      throw badRequest('audio_too_long', `Audio dài quá ${this.cfg.maxAudioSeconds} giây`);
    }
    const mime = sniffAudioMime(file.buffer);
    if (!mime) throw new AppError(415, 'unsupported_media_type', 'Định dạng audio không được hỗ trợ');

    // ---- BR07: idempotency theo (owner, request_id) ----
    const existing = await this.jobs.findOne({ where: { ownerId, requestId: dto.request_id } });
    if (existing) {
      if (existing.responseJson) return JSON.parse(existing.responseJson) as VoiceResponse;
      const stale = Date.now() - existing.createdAt.getTime() > 60_000;
      if (existing.state === 'processing' && !stale) {
        throw conflict('processing', 'Yêu cầu này đang được xử lý, hãy thử lại sau ít giây');
      }
      await this.jobs.delete({ id: existing.id }); // job lỗi/treo cũ: cho phép chạy lại cùng request_id
    }

    const event = await this.events.getOwned(ownerId, dto.event_id);
    if (event.status === 'closed') throw conflict('event_closed', 'Sự kiện đã đóng');

    // ---- BR12: quota phía server, trừ nguyên tử ----
    await this.quotas.reserve(ownerId);

    let job: VoiceJob;
    try {
      job = await this.jobs.save(
        this.jobs.create({
          ownerId,
          eventId: dto.event_id,
          requestId: dto.request_id,
          durationMs: dto.duration_ms,
          provider: this.ai.providerName,
          state: 'processing',
          warningCodes: '',
          responseJson: null,
          tokenUsage: null,
        }),
      );
    } catch {
      // request đồng thời cùng request_id: trả quota và để client thử lại
      await this.quotas.release(ownerId);
      throw conflict('processing', 'Yêu cầu này đang được xử lý, hãy thử lại sau ít giây');
    }

    let outcome;
    try {
      outcome = await this.ai.process(file.buffer, mime, dto.transcript_hint);
    } catch (e) {
      this.log.warn(`AI provider failed for job ${job.id}: ${(e as Error).message}`);
      await this.quotas.release(ownerId); // lỗi nhà cung cấp: không tính lượt
      job.state = 'failed';
      await this.jobs.save(job);
      throw new AppError(502, 'provider_error', 'Dịch vụ nhận dạng giọng nói tạm thời lỗi, hãy thử lại');
    }

    const { candidate, transcript } = outcome;
    const warnings = [...candidate.warnings];
    const name = candidate.guest_name ?? '';
    const amount = candidate.amount_vnd ?? 0;

    // ---- BR06: nghi trùng -> cảnh báo, KHÔNG auto-confirm, KHÔNG xoá/gộp ----
    const dups = await this.gifts.findDuplicates(ownerId, dto.event_id, name, amount);
    if (dups.length) warnings.push('possible_duplicate');

    const empty = warnings.includes('no_content') || (!name && amount === 0);
    let state: VoiceResponse['state'];
    if (empty) state = 'failed';
    else if (candidate.needs_review || dups.length || !name || amount <= 0) state = 'pending_review';
    else state = 'confirmed';

    if (state !== 'failed') {
      await this.gifts.insert(ownerId, {
        id: dto.request_id,
        eventId: dto.event_id,
        guestName: name,
        relationshipLabel: candidate.relationship_label,
        amountVnd: amount,
        note: null,
        status: state,
        source: 'voice',
        side: dto.side ?? 'mine',
        transcript: this.cfg.storeTranscript ? transcript.slice(0, 1000) : null,
      });
    }

    const response: VoiceResponse = {
      request_id: dto.request_id,
      job_id: job.id,
      state,
      transcript,
      candidate: {
        guest_name: candidate.guest_name,
        relationship_label: candidate.relationship_label,
        amount_vnd: candidate.amount_vnd,
      },
      warnings,
      duplicate_candidates: dups.map((d) => ({ gift_id: d.id, guest_name: d.guestName, amount_vnd: d.amountVnd })),
    };
    job.state = state;
    job.warningCodes = warnings.join(',').slice(0, 500);
    job.responseJson = JSON.stringify(response);
    await this.jobs.save(job);
    await this.audit.record(ownerId, 'voice', job.id, 'segment', null, {
      status: state,
      amount_vnd: amount,
      event_id: dto.event_id,
    });
    return response;
  }

  /** Poll kết quả (job async). */
  async getJob(ownerId: string, id: string) {
    const job = await this.jobs.findOne({ where: { id, ownerId } });
    if (!job) throw new AppError(404, 'not_found', 'Không tìm thấy job');
    return job.responseJson
      ? (JSON.parse(job.responseJson) as VoiceResponse)
      : { request_id: job.requestId, job_id: job.id, state: job.state };
  }
}
