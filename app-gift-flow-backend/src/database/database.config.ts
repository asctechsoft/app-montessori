import * as fs from 'fs';
import * as path from 'path';
import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/config';
import { ALL_ENTITIES } from './entities';
import { InitSchema1730000000000 } from './migrations/1730000000000-init-schema';
import { AddGiftSide1730000000001 } from './migrations/1730000000001-add-gift-side';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Prod: PostgreSQL + migration (không synchronize).
 * Dev/test: sql.js (WASM, không cần cài DB) + synchronize.
 */
export function buildDataSourceOptions(cfg: AppConfig): DataSourceOptions {
  const common = {
    entities: ALL_ENTITIES,
    namingStrategy: new SnakeNamingStrategy(),
    logging: false,
  };
  if (cfg.dbType === 'postgres') {
    return {
      ...common,
      type: 'postgres',
      url: cfg.databaseUrl,
      migrations: [InitSchema1730000000000, AddGiftSide1730000000001],
      migrationsRun: true,
      synchronize: false,
    };
  }
  const file = cfg.sqljsFile;
  const inMemory = file === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return {
    ...common,
    type: 'sqljs',
    location: inMemory ? undefined : file,
    autoSave: !inMemory,
    synchronize: true,
  } as DataSourceOptions;
}
