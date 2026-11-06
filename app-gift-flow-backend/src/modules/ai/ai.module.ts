import { Module } from '@nestjs/common';
import { AppConfig, CONFIG } from '../../config/config';
import { AiService } from './ai.service';
import { EXTRACTION_PROVIDER, STT_PROVIDER } from './ai.types';
import { MockSttProvider, OpenAiExtractionProvider, OpenAiSttProvider } from './providers';
import { RuleExtractionProvider } from './rule-extraction';

@Module({
  providers: [
    AiService,
    {
      provide: STT_PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => (cfg.aiProvider === 'openai' ? new OpenAiSttProvider(cfg) : new MockSttProvider()),
    },
    {
      provide: EXTRACTION_PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.aiProvider === 'openai' ? new OpenAiExtractionProvider(cfg) : new RuleExtractionProvider(),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
