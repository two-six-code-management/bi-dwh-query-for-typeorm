/**
 * 方言の結合テスト。MySqlDialect と PostgresDialect の各メソッドが、実際の DB で同じ結果になることを確かめる。
 * どちらの DB でも同じ期待する値と比べるため、両方で流せば、2つの方言の結果が一致することになる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RdsQueryEngine, todayInTimeZone} from 'bi-dwh-query-core';
import type {SqlDialect} from 'bi-dwh-query-core';

import {TypeOrmRdsSqlRunner} from '../TypeOrmRdsSqlRunner.js';
import {
    TEST_DATABASES,
    normalizeRows,
    skipReason,
    withDataSource,
} from './databases.js';
import type {TestDatabase} from './databases.js';

/** 集約を確かめる表（n, s） */
const ROWS = `(
    SELECT 1 AS n, 'x' AS s
    UNION ALL SELECT 1, 'x'
    UNION ALL SELECT 2, 'x'
    UNION ALL SELECT 2, 'y'
    UNION ALL SELECT 3, 'b'
) t`;

interface DialectCase {
    readonly label: string;
    /** 値を1つ返す式。from があれば、その表から求める */
    readonly expression: (dialect: SqlDialect) => string;
    readonly from?: string;
    readonly expected: unknown;
    /** この DB でだけ確かめる */
    readonly only?: TestDatabase['type'];
}

const TS = (value: string) => `TIMESTAMP '${value}'`;
const DATE = (value: string) => `DATE '${value}'`;

const CASES: readonly DialectCase[] = [
    {
        label: '真偽値（真）',
        expression: (d) => d.booleanLiteral(true),
        expected: 1,
    },
    {
        label: '真偽値（偽）',
        expression: (d) => d.booleanLiteral(false),
        expected: 0,
    },
    {
        label: '2列の組の重複なし件数',
        expression: (d) => d.countDistinctPair('n', 's'),
        from: ROWS,
        expected: 4,
    },
    {
        label: '条件に当てはまる行の件数',
        expression: (d) => d.countIf('n >= 2'),
        from: ROWS,
        expected: 3,
    },
    {
        label: '条件に当てはまる行がある',
        expression: (d) => d.anyTrue('n >= 3'),
        from: ROWS,
        expected: 1,
    },
    {
        label: '条件に当てはまる行が無い',
        expression: (d) => d.anyTrue('n >= 9'),
        from: ROWS,
        expected: 0,
    },
    {
        label: '重複なしで名前順に連結する',
        expression: (d) => d.stringAggDistinctSorted('s', ','),
        from: ROWS,
        expected: 'b,x,y',
    },
    {
        label: '日付に分を足す',
        expression: (d) => d.addMinutes('90', DATE('2026-11-09')),
        expected: '2026-11-09 01:30:00',
    },
    {
        label: '日時に分を足す',
        expression: (d) => d.addMinutes('15 * 2', TS('2026-11-09 23:45:00')),
        expected: '2026-11-10 00:15:00',
    },
    {
        label: '日付に日数を足す',
        expression: (d) => d.addDays(DATE('2026-11-29'), '3'),
        expected: '2026-12-02 00:00:00',
    },
    {
        label: '日時から時間を引く',
        expression: (d) => d.subtractHours(TS('2026-11-09 02:00:00'), '3'),
        expected: '2026-11-08 23:00:00',
    },
    {
        label: '日数の差',
        expression: (d) =>
            d.dateDiffDays(DATE('2026-11-09'), DATE('2026-10-31')),
        expected: 9,
    },
    {
        label: '日数の差（負）',
        expression: (d) =>
            d.dateDiffDays(DATE('2026-10-31'), DATE('2026-11-09')),
        expected: -9,
    },
    {
        label: '日時を日付にしてからの日数の差（時刻を見ない）',
        expression: (d) =>
            d.dateDiffDays(
                d.asDate(TS('2026-11-09 00:10:00')),
                d.asDate(TS('2026-11-08 23:50:00'))
            ),
        expected: 1,
    },
    {
        label: '2つの日時の間の分（切り捨て）',
        expression: (d) =>
            d.minutesBetween(
                TS('2026-11-09 10:00:00'),
                TS('2026-11-09 10:59:59')
            ),
        expected: 59,
    },
    {
        label: '2つの日時の間の分（負は0へ向けて切り捨て）',
        expression: (d) =>
            d.minutesBetween(
                TS('2026-11-09 10:59:59'),
                TS('2026-11-09 10:00:00')
            ),
        expected: -59,
    },
    {
        label: '2つの日時の間の秒（切り捨て）',
        expression: (d) =>
            d.secondsBetween(
                TS('2026-11-09 10:00:00.000'),
                TS('2026-11-09 10:00:01.900')
            ),
        expected: 1,
    },
    {
        label: '2つの日時の間の秒（負は0へ向けて切り捨て）',
        expression: (d) =>
            d.secondsBetween(
                TS('2026-11-09 10:00:01.900'),
                TS('2026-11-09 10:00:00.000')
            ),
        expected: -1,
    },
    {
        label: '小数の割り算',
        expression: (d) => `${d.asDouble('7')} / 2`,
        expected: 3.5,
    },
    {
        label: '文字列を整数にする',
        expression: (d) => d.toInteger("'42'"),
        expected: 42,
    },
    {
        label: '数字でない文字列を整数にしてもエラーにしない（PostgreSQL は NULL。Athena と同じ）',
        expression: (d) => d.toInteger("'abc'"),
        expected: null,
        only: 'postgres',
    },
    {
        label: '曜日（月曜は0）',
        expression: (d) => d.weekday(DATE('2026-11-09')),
        expected: 0,
    },
    {
        label: '曜日（日曜は6）',
        expression: (d) => d.weekday(DATE('2026-11-15')),
        expected: 6,
    },
    {
        label: 'その週の月曜（日曜から）',
        expression: (d) => d.weekStart(DATE('2026-11-15')),
        expected: '2026-11-09 00:00:00',
    },
    {
        label: 'その週の月曜（月曜から）',
        expression: (d) => d.weekStart(DATE('2026-11-09')),
        expected: '2026-11-09 00:00:00',
    },
    {
        label: '整数の割り算',
        expression: (d) => d.integerDivide('7', '2'),
        expected: 3,
    },
    {
        label: '整数の割り算（負は0へ向けて切り捨て）',
        expression: (d) => d.integerDivide('-7', '2'),
        expected: -3,
    },
    {
        label: '今日（JST）',
        expression: (d) => d.currentDate(),
        expected: `${todayInTimeZone()} 00:00:00`,
        // MySQL の方言は、接続のタイムゾーンが JST であることを前提にしている
        only: 'postgres',
    },
];

TEST_DATABASES.forEach((database) => {
    const skip = database.url ? false : skipReason(database);

    test(`${database.name}: 方言の各メソッドが期待する値を返す`, {skip}, () =>
        withDataSource(database, async (dataSource) => {
            const engine = new RdsQueryEngine({
                runner: new TypeOrmRdsSqlRunner(dataSource),
            });
            const cases = CASES.filter(
                ({only}) => only === undefined || only === database.type
            );
            const actual = await Promise.all(
                cases.map(async ({label, expression, from}) => {
                    const rows = await engine.select<Record<string, unknown>>(
                        `SELECT ${expression(engine.dialect)} AS v${
                            from ? ` FROM ${from}` : ''
                        }`,
                        {}
                    );
                    return [label, normalizeRows(rows)[0]?.v];
                })
            );

            assert.deepEqual(
                Object.fromEntries(actual),
                Object.fromEntries(
                    cases.map(({label, expected}) => [label, expected])
                )
            );
        })
    );

    test(`${database.name}: GROUP BY の列と、件数の指定`, {skip}, () =>
        withDataSource(database, async (dataSource) => {
            const engine = new RdsQueryEngine({
                runner: new TypeOrmRdsSqlRunner(dataSource),
            });
            const {dialect} = engine;

            const rows = await engine.select<Record<string, unknown>>(
                `SELECT CASE WHEN n >= 2 THEN 'many' ELSE 'one' END AS tier, COUNT(*) AS c
                 FROM ${ROWS}
                 GROUP BY ${dialect.groupByColumns([
                     {
                         expression:
                             "CASE WHEN n >= 2 THEN 'many' ELSE 'one' END",
                         alias: 'tier',
                     },
                 ])}
                 ORDER BY tier ${dialect.limitOffset('1', '1')}`,
                {}
            );

            assert.deepEqual(normalizeRows(rows), [{tier: 'one', c: 2}]);
        })
    );
});
