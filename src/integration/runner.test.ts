/**
 * TypeORM の実行役の結合テスト。実際の DB へ、パラメータ・配列・空配列・組・型付きの値を正しく渡せることを確かめる。
 * データソース（createBiDataSource）を、使う側と同じ形で組み立てて流す。
 * PostgreSQL は、IS NULL とだけ比べるパラメータの型を決められない（could not determine data type of parameter）ため、
 * NULL を渡すパラメータは列と比べて型が決まる書き方にする。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BI_ENGINE,
    BI_PERIOD,
    biSqlDate,
    biSqlTimestamp,
    createBiDataSource,
} from 'bi-dwh-query-core';

import {TypeOrmRdsSqlRunner} from '../TypeOrmRdsSqlRunner.js';
import {
    TEST_DATABASES,
    normalizeRows,
    skipReason,
    withDataSource,
} from './databases.js';

const ROWS = `(
    SELECT 1 AS n, 'x' AS s, DATE '2026-10-01' AS d, TIMESTAMP '2026-10-01 10:00:00' AS at
    UNION ALL SELECT 2, 'y', DATE '2026-10-15', TIMESTAMP '2026-10-15 23:59:59'
    UNION ALL SELECT 3, 'it''s', DATE '2026-11-01', TIMESTAMP '2026-11-01 00:00:00'
) t`;

TEST_DATABASES.forEach((database) => {
    const skip = database.url ? false : skipReason(database);

    const selectWith = (
        sql: string,
        params: Parameters<
            ReturnType<typeof createBiDataSource>['select']
        >[0]['params']
    ) =>
        withDataSource(database, async (dataSource) => {
            const biDataSource = createBiDataSource({
                id: 'test.typeorm',
                config: {
                    engine: BI_ENGINE.RDS,
                    rdsRetentionDays: 30,
                    athena: {
                        workGroup: null,
                        database: null,
                        catalog: 'AwsDataCatalog',
                    },
                },
                rdsRunner: new TypeOrmRdsSqlRunner(dataSource),
            });
            const rows = await biDataSource.select<Record<string, unknown>>({
                period: BI_PERIOD.ALL_PERIOD,
                params,
                sql: () => sql,
            });
            return normalizeRows(rows);
        });

    test(
        `${database.name}: 日付・日時の値と、配列の値で絞り込める`,
        {skip},
        async () => {
            const rows = await selectWith(
                `SELECT n FROM ${ROWS}
             WHERE d >= :from AND at < :until AND s IN (:systems)
             ORDER BY n`,
                {
                    from: biSqlDate('2026-10-01'),
                    until: biSqlTimestamp('2026-11-01 00:00:00'),
                    systems: ['x', 'y', "it's"],
                }
            );

            assert.deepEqual(rows, [{n: 1}, {n: 2}]);
        }
    );

    test(`${database.name}: 空配列は何にも当てはまらない`, {skip}, async () => {
        const rows = await selectWith(
            `SELECT n FROM ${ROWS} WHERE s IN (:systems)`,
            {systems: []}
        );

        assert.deepEqual(rows, []);
    });

    test(
        `${database.name}: 配列の配列は組として絞り込める`,
        {skip},
        async () => {
            const rows = await selectWith(
                `SELECT n FROM ${ROWS} WHERE (n, s) IN (:pairs) ORDER BY n`,
                {
                    pairs: [
                        [1, 'x'],
                        [2, 'z'],
                        [3, "it's"],
                    ],
                }
            );

            assert.deepEqual(rows, [{n: 1}, {n: 3}]);
        }
    );

    test(
        `${database.name}: 引用符を含む値・NULL・文字列の中のコロンを正しく扱う`,
        {skip},
        async () => {
            const rows = await selectWith(
                `SELECT n, '10:30' AS t FROM ${ROWS}
             WHERE s = :name AND n = COALESCE(:none, n)`,
                {name: "it's", none: null}
            );

            assert.deepEqual(rows, [{n: 3, t: '10:30'}]);
        }
    );

    test(`${database.name}: 値が無くても実行できる`, {skip}, async () => {
        const rows = await selectWith(`SELECT COUNT(*) AS c FROM ${ROWS}`, {});

        assert.deepEqual(rows, [{c: 3}]);
    });
});
