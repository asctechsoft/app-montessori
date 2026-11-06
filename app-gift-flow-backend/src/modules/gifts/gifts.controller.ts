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
import { ConfirmGiftDto, CreateGiftDto, ListGiftsQuery, PatchGiftDto, UpsertGiftDto } from './gifts.dto';
import { GiftsService } from './gifts.service';

@ApiTags('gifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1')
export class GiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @Get('events/:eventId/gifts')
  list(
    @CurrentUser() u: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() q: ListGiftsQuery,
  ) {
    return this.gifts.list(u.id, eventId, q);
  }

  @Post('events/:eventId/gifts')
  create(
    @CurrentUser() u: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateGiftDto,
  ) {
    return this.gifts.createManual(u.id, eventId, dto);
  }

  @Get('gifts/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gifts.get(u.id, id);
  }

  @Put('gifts/:id')
  upsert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertGiftDto) {
    return this.gifts.upsert(u.id, id, dto);
  }

  @Patch('gifts/:id')
  patch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchGiftDto) {
    return this.gifts.patch(u.id, id, dto);
  }

  @Post('gifts/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmGiftDto) {
    return this.gifts.confirm(u.id, id, dto);
  }

  @Delete('gifts/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.gifts.remove(u.id, id);
  }
}
