/**
 * TypeORM の実行役のテスト。DataSource（0.3）/ Connection（0.2）は、記録するだけの偽物にする。
 * 実際の DB での確認は src/integration にある。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RDS_DATABASE_TYPE, RdsQueryEngine, biSqlDate} from 'bi-dwh-query-core';
import {defineBiQueryEngineContract} from 'bi-dwh-query-core/testing';

import {TypeOrmRdsSqlRunner} from './TypeOrmRdsSqlRunner.js';
import type {TypeOrmDataSourceLike} from './TypeOrmRdsSqlRunner.js';

interface Call {
    readonly escaped: {sql: string; parameters: Record<string, unknown>};
    readonly query: {sql: string; values: unknown[] | undefined};
}

/** 偽の DataSource。TypeORM の MySQL のドライバと同じく :name を ? にし、値を順に並べる */
const createDataSource = (
    type: string,
    result: unknown = [{n: 1}]
): {dataSource: TypeOrmDataSourceLike; calls: Call[]} => {
    const calls: Call[] = [];
    const escaped: Array<Call['escaped']> = [];
    const dataSource: TypeOrmDataSourceLike = {
        options: {type},
        driver: {
            escapeQueryWithParameters: (sql, parameters) => {
                escaped.push({sql, parameters});
                const values: unknown[] = [];
                const replaced = sql.replace(/:(\w+)/g, (_, key: string) => {
                    values.push(parameters[key]);
                    return '?';
                });
                return [replaced, values];
            },
        },
        query: async (sql, values) => {
            calls.push({
                escaped: escaped[escaped.length - 1] as Call['escaped'],
                query: {sql, values},
            });
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    };
    return {dataSource, calls};
};

test('DB の種類を接続の設定から決める', () => {
    [
        ['mysql', RDS_DATABASE_TYPE.MYSQL],
        ['mariadb', RDS_DATABASE_TYPE.MYSQL],
        ['aurora-mysql', RDS_DATABASE_TYPE.MYSQL],
        ['postgres', RDS_DATABASE_TYPE.POSTGRES],
        ['aurora-postgres', RDS_DATABASE_TYPE.POSTGRES],
    ].forEach(([type, expected]) =>
        assert.equal(
            new TypeOrmRdsSqlRunner(createDataSource(type as string).dataSource)
                .databaseType,
            expected,
            type
        )
    );
});

test('対応していない DB は、作るときに例外にする', () => {
    assert.throws(
        () => new TypeOrmRdsSqlRunner(createDataSource('sqlite').dataSource),
        /sqlite/
    );
});

test('配列を展開してから TypeORM のドライバでパラメータにし、行を返す', async () => {
    const {dataSource, calls} = createDataSource('mysql');
    const runner = new TypeOrmRdsSqlRunner(dataSource);

    const rows = await runner.select(
        'SELECT n FROM t WHERE d >= :from AND s IN (:systems) AND x IN (:none)',
        {from: '2026-10-01', systems: ['alpha', 'beta'], none: []}
    );

    assert.deepEqual(rows, [{n: 1}]);
    assert.deepEqual(calls, [
        {
            escaped: {
                sql: 'SELECT n FROM t WHERE d >= :from AND s IN (:systems__0, :systems__1) AND x IN (NULL)',
                parameters: {
                    from: '2026-10-01',
                    systems__0: 'alpha',
                    systems__1: 'beta',
                },
            },
            query: {
                sql: 'SELECT n FROM t WHERE d >= ? AND s IN (?, ?) AND x IN (NULL)',
                values: ['2026-10-01', 'alpha', 'beta'],
            },
        },
    ]);
});

test('TypeORM の失敗は握りつぶさずにそのまま投げる', async () => {
    const runner = new TypeOrmRdsSqlRunner(
        createDataSource('mysql', new Error('typeorm failed')).dataSource
    );

    await assert.rejects(() => runner.select('SELECT 1', {}), /typeorm failed/);
});

test('RDS の実行エンジンに渡すと、DB の種類の方言になり、型付きの値は素の値で渡る', async () => {
    const {dataSource, calls} = createDataSource('postgres');
    const engine = new RdsQueryEngine({
        runner: new TypeOrmRdsSqlRunner(dataSource),
    });

    await engine.select('SELECT 1 WHERE d >= :from', {
        from: biSqlDate('2026-10-01'),
    });

    assert.equal(engine.dialect.booleanLiteral(true), 'TRUE');
    assert.deepEqual(calls[0]?.query.values, ['2026-10-01']);
});

defineBiQueryEngineContract('TypeOrmRdsSqlRunner', {
    createReturning: (rows) =>
        new RdsQueryEngine({
            runner: new TypeOrmRdsSqlRunner(
                createDataSource('mysql', rows).dataSource
            ),
        }),
    createFailing: (error) =>
        new RdsQueryEngine({
            runner: new TypeOrmRdsSqlRunner(
                createDataSource('mysql', error).dataSource
            ),
        }),
});
