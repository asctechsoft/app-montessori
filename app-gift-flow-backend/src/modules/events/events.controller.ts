import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateEventDto, PatchEventDto, UpsertEventDto } from './events.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('include_deleted') includeDeleted?: string) {
    return this.events.list(u.id, includeDeleted === 'true');
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEventDto) {
    return this.events.create(u.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(u.id, id);
  }

  /** Upsert idempotent dùng cho đồng bộ outbox của app. */
  @Put(':id')
  upsert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertEventDto) {
    return this.events.upsert(u.id, id, dto);
  }

  @Patch(':id')
  patch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchEventDto) {
    return this.events.patch(u.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.events.remove(u.id, id);
  }
}
