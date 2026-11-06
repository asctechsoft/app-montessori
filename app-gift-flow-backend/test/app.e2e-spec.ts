import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config/config';
import { GoogleTokenVerifier } from '../src/modules/auth/google-verifier';

const AUDIO = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(64)]);

describe('GiftFlow API (e2e, sql.js in-memory, mock AI)', () => {
  let app: INestApplication;
  let http: any;
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'giftflow-exp-'));

  const guest = async () => {
    const r = await request(http).post('/v1/auth/guest').send({ device_id: randomUUID() }).expect(200);
    return { auth: `Bearer ${r.body.access_token}`, refresh: r.body.refresh_token as string };
  };
  const mkEvent = async (auth: string, id = randomUUID()) => {
    await request(http)
      .put(`/v1/events/${id}`)
      .set('Authorization', auth)
      .send({ name: 'Lễ cưới Minh & Trang', event_date: '2026-05-24', type: 'wedding' })
      .expect(200);
    return id;
  };
  const voice = (auth: string, eventId: string, requestId: string, hint: string) =>
    request(http)
      .post('/v1/voice/segments')
      .set('Authorization', auth)
      .field('event_id', eventId)
      .field('request_id', requestId)
      .field('duration_ms', '3000')
      .field('transcript_hint', hint)
      .attach('audio', AUDIO, { filename: 'seg.m4a', contentType: 'audio/mp4' });

  beforeAll(async () => {
    process.env.THROTTLE_GUEST_LIMIT = '1000';
    const cfg = loadConfig({
      NODE_ENV: 'test',
      DB_TYPE: 'sqljs',
      SQLJS_FILE: ':memory:',
      JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123456',
      AI_PROVIDER: 'mock',
      QUOTA_LIMIT_PER_PERIOD: '5',
      EXPORT_DIR: exportDir,
      THROTTLE_LIMIT: '10000',
    } as NodeJS.ProcessEnv);
    const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(cfg)] })
      .overrideProvider(GoogleTokenVerifier)
      .useValue({ verify: async (t: string) => ({ sub: 'sub-' + t.slice(0, 12), name: 'Minh' }) })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, cfg);
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(exportDir, { recursive: true, force: true });
  });

  it('health live/ready', async () => {
    await request(http).get('/health/live').expect(200);
    await request(http).get('/health/ready').expect(200);
  });

  it('401 khi thiếu token, lỗi đúng shape {code,message,request_id}', async () => {
    const r = await request(http).get('/v1/events').expect(401);
    expect(r.body).toMatchObject({ code: 'unauthorized' });
    expect(r.body.request_id).toBeTruthy();
  });

  it('guest auth + me + refresh xoay vòng (dùng lại token cũ bị thu hồi)', async () => {
    const g = await guest();
    const me = await request(http).get('/v1/me').set('Authorization', g.auth).expect(200);
    expect(me.body.quota).toMatchObject({ limit: 5, used: 0 });

    const r1 = await request(http).post('/v1/auth/refresh').send({ refresh_token: g.refresh }).expect(200);
    expect(r1.body.refresh_token).not.toBe(g.refresh);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: g.refresh }).expect(401);
    // phát hiện tái sử dụng => thu hồi cả token mới
    await request(http).post('/v1/auth/refresh').send({ refresh_token: r1.body.refresh_token }).expect(401);
  });

  it('validation: device_id sai => 400', async () => {
    const r = await request(http).post('/v1/auth/guest').send({ device_id: 'x' }).expect(400);
    expect(r.body.code).toBe('validation_error');
  });

  it('luồng nhập tay: tạo sự kiện, thêm, idempotent, sửa, xoá mềm, thống kê', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    const rid = randomUUID();
    const body = { client_request_id: rid, guest_name: 'Chị Lan', amount_vnd: 1_000_000, relationship_label: 'Đồng nghiệp' };
    const a = await request(http).post(`/v1/events/${ev}/gifts`).set('Authorization', auth).send(body).expect(201);
    const b = await request(http).post(`/v1/events/${ev}/gifts`).set('Authorization', auth).send(body).expect(201);
    expect(b.body.id).toBe(a.body.id); // BR07: gửi lại không tạo bản ghi thứ 2

    // BR02: số tiền <= 0 bị từ chối
    await request(http)
      .post(`/v1/events/${ev}/gifts`)
      .set('Authorization', auth)
      .send({ ...body, client_request_id: randomUUID(), amount_vnd: 0 })
      .expect(400);
    await request(http)
      .post(`/v1/events/${ev}/gifts`)
      .set('Authorization', auth)
      .send({ ...body, client_request_id: randomUUID(), amount_vnd: 1.5 })
      .expect(400);

    await request(http)
      .patch(`/v1/gifts/${a.body.id}`)
      .set('Authorization', auth)
      .send({ amount_vnd: 1_500_000 })
      .expect(200);

    let s = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(s.body.confirmed).toMatchObject({ total_vnd: 1_500_000, count: 1, guests: 1 });
    expect(s.body.by_relationship[0]).toMatchObject({ label: 'Đồng nghiệp', total_vnd: 1_500_000 });

    await request(http).delete(`/v1/gifts/${a.body.id}`).set('Authorization', auth).expect(204);
    await request(http).delete(`/v1/gifts/${a.body.id}`).set('Authorization', auth).expect(204); // idempotent
    s = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(s.body.confirmed.total_vnd).toBe(0); // BR10: xoá mềm không tính
  });

  it('PUT upsert: last-write-wins theo updated_at', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    const id = randomUUID();
    const base = { event_id: ev, guest_name: 'Em Đức', amount_vnd: 2_000_000, status: 'confirmed', source: 'manual' };
    await request(http).put(`/v1/gifts/${id}`).set('Authorization', auth)
      .send({ ...base, updated_at: '2026-05-24T10:00:00.000Z' }).expect(200);
    const stale = await request(http).put(`/v1/gifts/${id}`).set('Authorization', auth)
      .send({ ...base, amount_vnd: 9_000_000, updated_at: '2026-05-24T09:00:00.000Z' }).expect(200);
    expect(stale.body.amount_vnd).toBe(2_000_000); // bản cũ hơn bị bỏ
    const fresh = await request(http).put(`/v1/gifts/${id}`).set('Authorization', auth)
      .send({ ...base, amount_vnd: 2_500_000, updated_at: '2026-05-24T11:00:00.000Z' }).expect(200);
    expect(fresh.body.amount_vnd).toBe(2_500_000);
    // confirmed không tên => 400
    await request(http).put(`/v1/gifts/${randomUUID()}`).set('Authorization', auth)
      .send({ ...base, guest_name: '' }).expect(400);
  });

  it('voice: confirmed / pending / duplicate / idempotent / quota', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);

    // 1) đủ dữ liệu => confirmed, vào tổng
    const r1 = randomUUID();
    const v1 = await voice(auth, ev, r1, 'Anh Nguyễn Văn Hùng, bạn bố, hai triệu').expect(200);
    expect(v1.body).toMatchObject({
      state: 'confirmed',
      candidate: { guest_name: 'Nguyễn Văn Hùng', amount_vnd: 2_000_000, relationship_label: 'Bạn bố' },
    });

    // 2) gửi lại cùng request_id => phát lại, không trừ thêm quota, không tạo thêm bản ghi
    const again = await voice(auth, ev, r1, 'Anh Nguyễn Văn Hùng, bạn bố, hai triệu').expect(200);
    expect(again.body.job_id).toBe(v1.body.job_id);
    const me = await request(http).get('/v1/me').set('Authorization', auth).expect(200);
    expect(me.body.quota.used).toBe(1);

    // 3) cùng tên + số tiền với request_id mới => nghi trùng => pending_review (không auto-confirm)
    const v3 = await voice(auth, ev, randomUUID(), 'Anh Nguyễn Văn Hùng, bạn bố, hai triệu').expect(200);
    expect(v3.body.state).toBe('pending_review');
    expect(v3.body.warnings).toContain('possible_duplicate');
    expect(v3.body.duplicate_candidates[0].gift_id).toBe(r1);

    // 4) số tiền mơ hồ => pending, không bịa
    const v4 = await voice(auth, ev, randomUUID(), 'Bác Tư năm trăm').expect(200);
    expect(v4.body.state).toBe('pending_review');
    expect(v4.body.candidate.amount_vnd).toBeNull();

    // thống kê chỉ cộng confirmed
    let s = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(s.body.confirmed.total_vnd).toBe(2_000_000);
    expect(s.body.pending.count).toBe(2);

    // xác nhận bản pending (có sửa) => tính vào tổng
    await request(http)
      .post(`/v1/gifts/${v4.body.request_id}/confirm`)
      .set('Authorization', auth)
      .send({ guest_name: 'Bác Tư', amount_vnd: 500_000 })
      .expect(200);
    s = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(s.body.confirmed.total_vnd).toBe(2_500_000);

    // 5) quota server-side: limit=5, đã dùng 3 -> 2 lượt nữa rồi 429
    await voice(auth, ev, randomUUID(), 'Anh Thành mừng một triệu rưỡi').expect(200);
    await voice(auth, ev, randomUUID(), 'Chị Lan đồng nghiệp một triệu').expect(200);
    const over = await voice(auth, ev, randomUUID(), 'Em Đức bạn thân hai triệu').expect(429);
    expect(over.body.code).toBe('quota_exceeded');
  });

  it('voice: từ chối file không phải audio (magic bytes) và thiếu file', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    const bad = await request(http)
      .post('/v1/voice/segments')
      .set('Authorization', auth)
      .field('event_id', ev)
      .field('request_id', randomUUID())
      .field('duration_ms', '3000')
      .attach('audio', Buffer.from('<?php echo 1; ?> not audio at all'), { filename: 'a.m4a', contentType: 'audio/mp4' })
      .expect(415);
    expect(bad.body.code).toBe('unsupported_media_type');
    await request(http)
      .post('/v1/voice/segments')
      .set('Authorization', auth)
      .field('event_id', ev)
      .field('request_id', randomUUID())
      .field('duration_ms', '3000')
      .expect(400);
  });

  it('BR01 / IDOR: user khác không đọc/sửa/xoá/xuất dữ liệu của người khác', async () => {
    const a = await guest();
    const b = await guest();
    const ev = await mkEvent(a.auth);
    const gid = randomUUID();
    await request(http).put(`/v1/gifts/${gid}`).set('Authorization', a.auth)
      .send({ event_id: ev, guest_name: 'Anh Hùng', amount_vnd: 1_000_000, status: 'confirmed' }).expect(200);

    await request(http).get(`/v1/events/${ev}`).set('Authorization', b.auth).expect(404);
    await request(http).get(`/v1/events/${ev}/gifts`).set('Authorization', b.auth).expect(404);
    await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', b.auth).expect(404);
    await request(http).get(`/v1/gifts/${gid}`).set('Authorization', b.auth).expect(404);
    await request(http).patch(`/v1/gifts/${gid}`).set('Authorization', b.auth).send({ amount_vnd: 1 }).expect(404);
    await request(http).delete(`/v1/gifts/${gid}`).set('Authorization', b.auth).expect(404);
    await request(http).put(`/v1/gifts/${gid}`).set('Authorization', b.auth)
      .send({ event_id: ev, guest_name: 'X', amount_vnd: 5, status: 'confirmed' }).expect(404);
    await request(http).put(`/v1/events/${ev}`).set('Authorization', b.auth)
      .send({ name: 'hack', event_date: '2026-01-01' }).expect(404);
    await request(http).post(`/v1/events/${ev}/exports`).set('Authorization', b.auth).send({}).expect(404);
    const list = await request(http).get('/v1/events').set('Authorization', b.auth).expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('phân trang cursor ổn định + tìm kiếm không dấu', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    for (let i = 1; i <= 5; i++) {
      await request(http).put(`/v1/gifts/${randomUUID()}`).set('Authorization', auth).send({
        event_id: ev,
        guest_name: i === 3 ? 'Nguyễn Văn Hùng' : `Khách ${i}`,
        amount_vnd: i * 100_000,
        status: 'confirmed',
        created_at: `2026-05-24T10:0${i}:00.000Z`,
        updated_at: `2026-05-24T10:0${i}:00.000Z`,
      }).expect(200);
    }
    const p1 = await request(http).get(`/v1/events/${ev}/gifts?limit=2`).set('Authorization', auth).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.next_cursor).toBeTruthy();
    const p2 = await request(http)
      .get(`/v1/events/${ev}/gifts?limit=2&cursor=${p1.body.next_cursor}`)
      .set('Authorization', auth)
      .expect(200);
    const p3 = await request(http)
      .get(`/v1/events/${ev}/gifts?limit=2&cursor=${p2.body.next_cursor}`)
      .set('Authorization', auth)
      .expect(200);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((g: any) => g.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.body.next_cursor).toBeNull();

    const q = await request(http).get(`/v1/events/${ev}/gifts?q=nguyen%20van%20hung`).set('Authorization', auth).expect(200);
    expect(q.body.items).toHaveLength(1);
    await request(http).get(`/v1/events/${ev}/gifts?cursor=@@@`).set('Authorization', auth).expect(400);
  });

  it('export XLSX: đối soát tổng, chống formula injection, tải về', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    const put = (name: string, amount: number, status = 'confirmed') =>
      request(http).put(`/v1/gifts/${randomUUID()}`).set('Authorization', auth)
        .send({ event_id: ev, guest_name: name, amount_vnd: amount, status }).expect(200);
    await put('=HYPERLINK("http://evil")', 1_000_000);
    await put('Chị Lan', 2_000_000);
    await put('Bác Tư', 500_000, 'pending_review');

    const exp = await request(http)
      .post(`/v1/events/${ev}/exports`)
      .set('Authorization', auth)
      .send({ columns: ['guest', 'amount'], include_pending: true })
      .expect(201);
    expect(exp.body.rows).toBe(3);
    expect(exp.body.confirmed_total_vnd).toBe(3_000_000); // pending không cộng

    const stats = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(stats.body.confirmed.total_vnd).toBe(exp.body.confirmed_total_vnd); // BR10 đối soát

    const dl = await request(http)
      .get(exp.body.download_url)
      .set('Authorization', auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((dl.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // .xlsx = zip
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(dl.body as any);
    const ws = wb.getWorksheet('GiftFlow')!;
    const guests: any[] = [];
    ws.eachRow((row) => guests.push(row.getCell(2).value));
    expect(guests.some((v) => v === "'=HYPERLINK(\"http://evil\")")).toBe(true);
    expect(guests.some((v) => typeof v === 'string' && v.startsWith('='))).toBe(false);
    // user khác không tải được
    const other = await guest();
    await request(http).get(exp.body.download_url).set('Authorization', other.auth).expect(404);
  });

  it('PII: audit log không chứa tên khách', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    await request(http).put(`/v1/gifts/${randomUUID()}`).set('Authorization', auth)
      .send({ event_id: ev, guest_name: 'Tên Rất Riêng Tư', amount_vnd: 1_000_000, status: 'confirmed' }).expect(200);
    const ds = app.get(require('typeorm').DataSource);
    const rows = await ds.query('SELECT before_json, after_json FROM audit_logs');
    expect(JSON.stringify(rows)).not.toContain('Riêng Tư');
  });

  it('nhóm khách (mine/parents): lưu, lọc, thống kê, từ chối giá trị lạ', async () => {
    const { auth } = await guest();
    const ev = await mkEvent(auth);
    const put = (name: string, amount: number, side?: string) =>
      request(http)
        .put(`/v1/gifts/${randomUUID()}`)
        .set('Authorization', auth)
        .send({ event_id: ev, guest_name: name, amount_vnd: amount, status: 'confirmed', ...(side ? { side } : {}) });
    await put('Bạn A', 1_000_000).expect(200);
    await put('Bác B', 2_000_000, 'parents').expect(200);
    await put('Cô C', 500_000, 'parents').expect(200);
    await put('X', 1, 'enemy').expect(400);
    const l = await request(http).get(`/v1/events/${ev}/gifts?side=parents`).set('Authorization', auth).expect(200);
    expect(l.body.items).toHaveLength(2);
    const s = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', auth).expect(200);
    expect(s.body.by_side).toEqual(
      expect.arrayContaining([
        { side: 'mine', count: 1, total_vnd: 1_000_000 },
        { side: 'parents', count: 2, total_vnd: 2_500_000 },
      ]),
    );
    const v = await voice(auth, ev, randomUUID(), 'Anh Thành mừng một triệu rưỡi').field('side', 'parents').expect(200);
    const g = await request(http).get(`/v1/gifts/${v.body.request_id}`).set('Authorization', auth).expect(200);
    expect(g.body.side).toBe('parents');
  });

  it('đăng nhập Google gộp dữ liệu guest, thiết bị khác đăng nhập cùng Google thấy cùng dữ liệu', async () => {
    const g = await guest();
    const ev = await mkEvent(g.auth);
    await request(http)
      .put(`/v1/gifts/${randomUUID()}`)
      .set('Authorization', g.auth)
      .send({ event_id: ev, guest_name: 'Chị Lan', amount_vnd: 1_000_000, status: 'confirmed' })
      .expect(200);

    const idToken = 'a'.repeat(120);
    const r = await request(http).post('/v1/auth/google').set('Authorization', g.auth).send({ id_token: idToken }).expect(200);
    expect(r.body.display_name).toBe('Minh');
    const gAuth = `Bearer ${r.body.access_token}`;
    const stats = await request(http).get(`/v1/events/${ev}/stats`).set('Authorization', gAuth).expect(200);
    expect(stats.body.confirmed.total_vnd).toBe(1_000_000);

    const other = await guest();
    const r2 = await request(http).post('/v1/auth/google').set('Authorization', other.auth).send({ id_token: idToken }).expect(200);
    const events = await request(http)
      .get('/v1/events')
      .set('Authorization', `Bearer ${r2.body.access_token}`)
      .expect(200);
    expect(events.body.items).toHaveLength(1);
    await request(http).post('/v1/auth/google').send({ id_token: 'x' }).expect(400);
  });
});
