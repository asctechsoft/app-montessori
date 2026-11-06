import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/config';
import { buildDataSourceOptions } from './database.config';

/** Dùng cho CLI: npm run migration:run */
export default new DataSource({
  ...buildDataSourceOptions(loadConfig()),
  migrationsRun: false,
});
