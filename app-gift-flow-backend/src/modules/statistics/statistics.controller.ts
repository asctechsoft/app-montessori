import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatisticsService } from './statistics.service';

@ApiTags('statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/events')
export class StatisticsController {
  constructor(private readonly stats: StatisticsService) {}

  @Get(':id/stats')
  stats_(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.stats.forEvent(u.id, id);
  }
}
