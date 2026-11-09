/**
 * 配列の値を、要素ごとのパラメータへ展開する。
 *
 * TypeORM の :...name は空配列と組（配列の配列）を扱えず、PostgreSQL では配列が配列型の1つの値になる。
 * そこで TypeORM へ渡す前に自分で展開し、Sequelize の replacements と同じ意味にする。
 * - [1, 2] → :ids__0, :ids__1
 * - [] → NULL（IN () の構文エラーを避ける）
 * - [[1, 'x'], [2, 'y']] → (:p__0__0, :p__0__1), (:p__1__0, :p__1__1)
 */
import type {RdsParamValue, RdsParams} from 'bi-dwh-query-core';

/** 配列でない値 */
type ScalarValue = Exclude<RdsParamValue, readonly RdsParamValue[]>;

export interface ExpandedQuery {
    /** 配列のパラメータを展開したSQL */
    readonly sql: string;
    /** 配列でない値だけのパラメータ */
    readonly params: Readonly<Record<string, ScalarValue>>;
}

const NULL_LITERAL = 'NULL';

/** 展開した名前の区切り */
const INDEX_SEPARATOR = '__';

/**
 * 変えない字句と、パラメータ。
 * 文字列（'' と \' のエスケープ）・コメント・囲んだ識別子（`...` と "..."）・:: のキャストの中は変えない
 */
const TOKEN_PATTERN =
    /'(?:[^'\\]|''|\\.)*'|\/\*[\s\S]*?\*\/|--[^\n]*|`(?:[^`]|``)*`|"(?:[^"]|"")*"|::|:(?<param>[A-Za-z_]\w*)/g;

interface ExpandState {
    readonly params: Record<string, ScalarValue>;
    /** 配列を展開して作った名前 */
    readonly generated: Set<string>;
}

/**
 * 配列の要素をパラメータにして、SQLに書く名前を返す
 * @param name 展開した名前
 * @param value 要素
 * @param state 集めているパラメータ
 */
const placeElement = (
    name: string,
    value: RdsParamValue,
    state: ExpandState
): string => {
    if (!Array.isArray(value)) {
        state.params[name] = value as ScalarValue;
        state.generated.add(name);
        return `:${name}`;
    }
    return value.length === 0
        ? NULL_LITERAL
        : `(${value
              .map((element, index) =>
                  placeElement(
                      `${name}${INDEX_SEPARATOR}${index}`,
                      element,
                      state
                  )
              )
              .join(', ')})`;
};

/**
 * パラメータを、SQLに書く形にする。配列は要素ごとのパラメータへ展開する
 * @param name パラメータの名前
 * @param params 渡された値
 * @param state 集めているパラメータ
 */
const placeParam = (
    name: string,
    params: RdsParams,
    state: ExpandState
): string => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
        throw new Error(
            `TypeORM の実行役: パラメータ :${name} の値がありません`
        );
    }
    const value = params[name] as RdsParamValue;
    if (!Array.isArray(value)) {
        state.params[name] = value as ScalarValue;
        return `:${name}`;
    }
    return value.length === 0
        ? NULL_LITERAL
        : value
              .map((element, index) =>
                  placeElement(
                      `${name}${INDEX_SEPARATOR}${index}`,
                      element,
                      state
                  )
              )
              .join(', ');
};

/**
 * 展開した名前が、渡された名前と重ならないことを確かめる（重なると、どちらの値か決まらない）
 * @param params 渡された値
 * @param state 集めたパラメータ
 */
const assertNoCollision = (params: RdsParams, state: ExpandState): void => {
    const collided = [...state.generated].filter((name) =>
        Object.prototype.hasOwnProperty.call(params, name)
    );
    if (collided.length > 0) {
        throw new Error(
            `TypeORM の実行役: 配列を展開した名前が、渡されたパラメータと重なります: ${collided.join(
                ', '
            )}`
        );
    }
};

/**
 * 配列の値を要素ごとのパラメータへ展開する
 * @param sql :name の名前付きパラメータを含むSQL
 * @param params 名前付きパラメータの値
 */
export const expandArrayParams = (
    sql: string,
    params: RdsParams
): ExpandedQuery => {
    const state: ExpandState = {params: {}, generated: new Set()};
    const expanded = sql.replace(TOKEN_PATTERN, (token, ...args) => {
        const groups = args[args.length - 1] as {param?: string};
        return groups.param === undefined
            ? token
            : placeParam(groups.param, params, state);
    });
    assertNoCollision(params, state);
    return {sql: expanded, params: state.params};
};
