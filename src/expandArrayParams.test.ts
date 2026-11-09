/**
 * 配列の値の展開のテスト。
 * TypeORM へ渡す前に、IN (:ids) の配列を1つずつのパラメータへ展開する（Sequelize の replacements と同じ意味にする）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {expandArrayParams} from './expandArrayParams.js';

test('配列でない値は、SQLも値もそのまま', () => {
    assert.deepEqual(
        expandArrayParams('SELECT * FROM t WHERE d >= :from AND n = :n', {
            from: '2026-10-01',
            n: 1,
        }),
        {
            sql: 'SELECT * FROM t WHERE d >= :from AND n = :n',
            params: {from: '2026-10-01', n: 1},
        }
    );
});

test('配列は要素ごとのパラメータへ展開する', () => {
    assert.deepEqual(
        expandArrayParams('SELECT * FROM t WHERE s IN (:systems) AND n = :n', {
            systems: ['alpha', 'beta'],
            n: 1,
        }),
        {
            sql: 'SELECT * FROM t WHERE s IN (:systems__0, :systems__1) AND n = :n',
            params: {systems__0: 'alpha', systems__1: 'beta', n: 1},
        }
    );
});

test('同じ配列を2回使っても、どちらも展開する', () => {
    assert.equal(
        expandArrayParams('SELECT :ids, :ids', {ids: [1, 2]}).sql,
        'SELECT :ids__0, :ids__1, :ids__0, :ids__1'
    );
});

test('空配列は NULL にする（IN () の構文エラーを避ける。Sequelize の実行役も同じ）', () => {
    assert.deepEqual(
        expandArrayParams('SELECT * FROM t WHERE s IN (:systems)', {
            systems: [],
        }),
        {sql: 'SELECT * FROM t WHERE s IN (NULL)', params: {}}
    );
});

test('配列の配列は組（タプル）にする（Sequelize と同じ）', () => {
    assert.deepEqual(
        expandArrayParams('SELECT * FROM t WHERE (n, s) IN (:pairs)', {
            pairs: [
                [1, 'x'],
                [2, 'y'],
            ],
        }),
        {
            sql: 'SELECT * FROM t WHERE (n, s) IN ((:pairs__0__0, :pairs__0__1), (:pairs__1__0, :pairs__1__1))',
            params: {
                pairs__0__0: 1,
                pairs__0__1: 'x',
                pairs__1__0: 2,
                pairs__1__1: 'y',
            },
        }
    );
});

test('名前の一部が同じパラメータを取り違えない', () => {
    assert.equal(
        expandArrayParams('SELECT :id, :ids', {id: 9, ids: [1, 2]}).sql,
        'SELECT :id, :ids__0, :ids__1'
    );
});

test('文字列・コメント・囲んだ識別子・:: のキャストの中は変えない', () => {
    assert.equal(
        expandArrayParams(
            'SELECT \':ids\', "a:ids", `b:ids`, x::text /* :ids */ FROM t -- :ids\nWHERE n IN (:ids)',
            {ids: [1]}
        ).sql,
        'SELECT \':ids\', "a:ids", `b:ids`, x::text /* :ids */ FROM t -- :ids\nWHERE n IN (:ids__0)'
    );
    assert.equal(
        expandArrayParams("SELECT '10:30', 'it''s :ids'", {ids: [1]}).sql,
        "SELECT '10:30', 'it''s :ids'"
    );
});

test('値が渡されていないパラメータは例外にする（Sequelize と同じ）', () => {
    assert.throws(
        () => expandArrayParams('SELECT * FROM t WHERE d >= :from', {}),
        /:from/
    );
});

test('展開した名前が、渡された名前と重なるときは例外にする', () => {
    assert.throws(
        () =>
            expandArrayParams('SELECT :ids, :ids__0', {
                ids: [1],
                ids__0: 2,
            }),
        /ids__0/
    );
});
