/**
 * 結合テストの接続先。環境変数に接続先の URL があるときだけ、その DB で流す。
 *   BI_DWH_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:13307/test
 *   BI_DWH_TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:15433/test
 */
import {DataSource} from 'typeorm';

export interface TestDatabase {
    /** テスト名に出す名前 */
    readonly name: string;
    /** TypeORM の DB の種類 */
    readonly type: 'mysql' | 'postgres';
    /** 接続先。無ければ、その DB のテストは skip する */
    readonly url: string | undefined;
}

export const TEST_DATABASES: readonly TestDatabase[] = [
    {name: 'MySQL', type: 'mysql', url: process.env.BI_DWH_TEST_MYSQL_URL},
    {
        name: 'PostgreSQL',
        type: 'postgres',
        url: process.env.BI_DWH_TEST_POSTGRES_URL,
    },
];

/** skip の理由（接続先が無いとき） */
export const skipReason = ({name, type}: TestDatabase): string =>
    `${name} の接続先（BI_DWH_TEST_${type.toUpperCase()}_URL）がありません`;

/**
 * 接続して、終わったら切断する
 * @param database 接続先
 * @param use 接続を使う処理
 */
export const withDataSource = async <T>(
    {type, url}: TestDatabase,
    use: (dataSource: DataSource) => Promise<T>
): Promise<T> => {
    const dataSource = await new DataSource({type, url} as never).initialize();
    try {
        return await use(dataSource);
    } finally {
        await dataSource.destroy();
    }
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** 日時を、ドライバに依らない文字列（YYYY-MM-DD HH:mm:ss。ローカル時刻）にする */
const formatDate = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
        date.getSeconds()
    )}`;

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * DB とドライバで型が違う値を揃える。
 * - 真偽値（PostgreSQL）と 0/1（MySQL）は 0/1
 * - 数字の文字列（MySQL の SUM・PostgreSQL の bigint）は数値
 * - 日付・日時は YYYY-MM-DD HH:mm:ss の文字列
 * @param value DB から返った値
 */
export const normalizeValue = (value: unknown): unknown => {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (value instanceof Date) {
        return formatDate(value);
    }
    if (typeof value === 'string' && NUMERIC_TEXT.test(value)) {
        return Number(value);
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${value} 00:00:00`;
    }
    return value;
};

/** 行の値を揃える */
export const normalizeRows = (
    rows: readonly Record<string, unknown>[]
): Record<string, unknown>[] =>
    rows.map((row) =>
        Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
                key,
                normalizeValue(value),
            ])
        )
    );
