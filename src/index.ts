/**
 * bi-dwh-query-core を TypeORM で使うための RDS のSQL実行役。
 * 核の機能もここから import できるよう、すべて再エクスポートする。
 */
export * from 'bi-dwh-query-core';
export {TypeOrmRdsSqlRunner} from './TypeOrmRdsSqlRunner.js';
export type {TypeOrmDataSourceLike} from './TypeOrmRdsSqlRunner.js';
export {expandArrayParams} from './expandArrayParams.js';
export type {ExpandedQuery} from './expandArrayParams.js';
