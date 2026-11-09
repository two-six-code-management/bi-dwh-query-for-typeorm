import {RDS_DATABASE_TYPE} from 'bi-dwh-query-core';
import type {RdsDatabaseType, RdsParams, RdsSqlRunner} from 'bi-dwh-query-core';

import {expandArrayParams} from './expandArrayParams.js';

/**
 * TypeORM の接続のうち、この実行役が使う部分。
 * 0.3 / 1.x の DataSource と 0.2 の Connection をそのまま渡せる（TypeORM の型には依存しない）
 */
export interface TypeOrmDataSourceLike {
    readonly options: {readonly type: string};
    readonly driver: {
        /** :name の名前付きパラメータを、ドライバの書き方（MySQL は ?、PostgreSQL は $1）と値の配列にする */
        escapeQueryWithParameters(
            sql: string,
            parameters: Record<string, unknown>,
            nativeParameters: Record<string, unknown>
        ): [string, unknown[]];
    };
    query(query: string, parameters?: unknown[]): Promise<unknown>;
}

/** TypeORM の DB の種類（options.type）ごとの RDS の種類 */
const DATABASE_TYPES: ReadonlyMap<string, RdsDatabaseType> = new Map<
    string,
    RdsDatabaseType
>([
    ['mysql', RDS_DATABASE_TYPE.MYSQL],
    ['mariadb', RDS_DATABASE_TYPE.MYSQL],
    ['aurora-mysql', RDS_DATABASE_TYPE.MYSQL],
    ['postgres', RDS_DATABASE_TYPE.POSTGRES],
    ['aurora-postgres', RDS_DATABASE_TYPE.POSTGRES],
]);

/**
 * TypeORM の DB の種類から、RDS の種類を決める
 * @param type TypeORM の options.type
 */
const resolveDatabaseType = (type: string): RdsDatabaseType => {
    const databaseType = DATABASE_TYPES.get(type);
    if (!databaseType) {
        throw new Error(
            `TypeORM の実行役: 対応していない DB です: ${type}（対応: ${[
                ...DATABASE_TYPES.keys(),
            ].join(', ')}）`
        );
    }
    return databaseType;
};

/**
 * RDS のSQL実行役の TypeORM 版（MySQL / PostgreSQL）。
 * 配列の値を展開してから、TypeORM のドライバで名前付きパラメータを変換して実行する
 */
export class TypeOrmRdsSqlRunner implements RdsSqlRunner {
    readonly databaseType: RdsDatabaseType;

    private readonly dataSource: TypeOrmDataSourceLike;

    /**
     * @param dataSource TypeORM の DataSource（0.3 / 1.x）か Connection（0.2）
     */
    constructor(dataSource: TypeOrmDataSourceLike) {
        this.dataSource = dataSource;
        this.databaseType = resolveDatabaseType(dataSource.options.type);
    }

    async select<Row = Record<string, unknown>>(
        sql: string,
        params: RdsParams
    ): Promise<Row[]> {
        const expanded = expandArrayParams(sql, params);
        const [query, values] =
            this.dataSource.driver.escapeQueryWithParameters(
                expanded.sql,
                expanded.params,
                {}
            );
        return (await this.dataSource.query(query, values)) as Row[];
    }
}
