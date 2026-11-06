import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/** camelCase (entity) -> snake_case (cột DB), khớp migration SQL viết tay. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    return customName ? customName : snake([...embeddedPrefixes, propertyName].join('_'));
  }
}
