# bi-dwh-query-for-typeorm

[bi-dwh-query-core](https://github.com/two-six-code-management/bi-dwh-query-core)（BI集計の問い合わせを RDS と Amazon Athena のどちらでも実行できるようにする核）を、TypeORM で使うためのパッケージです。

- RDS のSQL実行役 `TypeOrmRdsSqlRunner` を持ちます。
- 核の機能をすべて再エクスポートしています。このパッケージだけを入れれば、核の機能もここから import できます。

| 対応 | 版 |
| --- | --- |
| TypeORM | 0.2（Connection）/ 0.3・1.x（DataSource） |
| DB | MySQL（mysql / mariadb / aurora-mysql）、PostgreSQL（postgres / aurora-postgres） |
| Node.js | 16.20 以上（ビルド・実行）。テストは 20 以上 |

## 導入

```jsonc
// package.json
{
  "dependencies": {
    "@aws-sdk/client-athena": "^3.552.0",
    "bi-dwh-query-for-typeorm": "github:two-six-code-management/bi-dwh-query-for-typeorm#v0.1.0"
  }
}
```

- GitHub のタグから入れます。`npm install` のときに `prepare` でビルドされます（核も同じです）。
- `@aws-sdk/client-athena` は、使う側で入れてください（Athena で実行するときに使います）。

## 使い方

```ts
import {AthenaClient} from '@aws-sdk/client-athena';
import {
    BI_PERIOD,
    TypeOrmRdsSqlRunner,
    biSqlDate,
    createBiDataSource,
    readBiQueryConfig,
} from 'bi-dwh-query-for-typeorm';

const config = readBiQueryConfig(process.env, {
    engine: 'BI_QUERY_ENGINE',
    athenaWorkGroup: 'BI_ATHENA_WORKGROUP',
    athenaDatabase: 'BI_ATHENA_DATABASE',
    athenaCatalog: 'BI_ATHENA_CATALOG',
    rdsRetentionDays: 'BI_RDS_RETENTION_DAYS',
});

export const salesBiDataSource = createBiDataSource({
    id: 'sales.aggregation',
    config,
    // TypeORM の DataSource（0.3・1.x）か Connection（0.2）を渡す。DB の種類は接続の設定から決まる
    rdsRunner: new TypeOrmRdsSqlRunner(dataSource),
    athena: {
        createClient: () => new AthenaClient({region: 'ap-northeast-1'}),
        schemaAliases: {aggregation: config.athena.database ?? ''},
    },
});

const rows = await salesBiDataSource.select({
    period: {from: '2026-10-01', to: '2026-10-31'},
    params: {from: biSqlDate('2026-10-01'), systems: ['alpha', 'beta']},
    sql: (dialect) => `
        SELECT f.system AS "system", ${dialect.countIf('f.is_new')} AS "newUsers"
        FROM aggregation.access_logs f
        WHERE f.access_date >= :from AND f.system IN (:systems)
        GROUP BY f.system
    `,
});
```

NestJS では、`@InjectDataSource()` で受け取った DataSource を渡して、プロバイダーとして定義します。

```ts
@Module({
    providers: [
        {
            provide: SALES_BI_DATA_SOURCE,
            inject: [getDataSourceToken()],
            useFactory: (dataSource: DataSource) =>
                createBiDataSource({id: 'sales.aggregation', config, rdsRunner: new TypeOrmRdsSqlRunner(dataSource), athena}),
        },
    ],
})
export class SalesBiModule {}
```

SQLの書き方・実行先の決め方・Athena と PostgreSQL の注意点は、[核の README](https://github.com/two-six-code-management/bi-dwh-query-core#readme) を見てください。

## パラメータの渡し方

TypeORM へは、次のように変換して渡します。Sequelize の `replacements` と同じ意味です（空配列を NULL にするのは、Sequelize の実行役も同じです）。

| SQL | 値 | TypeORM へ渡すSQL |
| --- | --- | --- |
| `IN (:ids)` | `[1, 2]` | `IN (:ids__0, :ids__1)` |
| `IN (:ids)` | `[]` | `IN (NULL)`（何にも当てはまらない） |
| `(a, b) IN (:pairs)` | `[[1, 'x'], [2, 'y']]` | `(a, b) IN ((:pairs__0__0, :pairs__0__1), (:pairs__1__0, :pairs__1__1))` |

- その後、TypeORM のドライバが `?`（MySQL）/ `$1`（PostgreSQL）にします。
- 文字列・コメント・囲んだ識別子・`::` の中は変えません。
- 値が渡されていないパラメータは例外にします。
- TypeORM の `:...name` は使いません。空配列と組を扱えず、PostgreSQL では配列が配列型の1つの値になるためです。
- PostgreSQL は、`:x IS NULL` のようにNULLとだけ比べるパラメータの型を決められません（`could not determine data type of parameter`）。`n = COALESCE(:x, n)` のように列と比べるか、`CAST(:x AS integer)` で型を付けてください。

## 開発

```bash
npm install
npm run typecheck
npm test            # 単体テスト
npm run build
npm run format
```

### 結合テスト

実際の MySQL と PostgreSQL で、実行役と方言を確かめます。MySqlDialect と PostgresDialect の各メソッドが同じ結果になることも、ここで確かめています。

```bash
docker run -d --rm --name bi-dwh-query-test-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=test -p 127.0.0.1:13307:3306 mysql:8.0
docker run -d --rm --name bi-dwh-query-test-postgres -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test -p 127.0.0.1:15433:5432 postgres:17

BI_DWH_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:13307/test \
BI_DWH_TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:15433/test \
npm run test:integration

docker stop bi-dwh-query-test-mysql bi-dwh-query-test-postgres
```

- 接続先の環境変数が無い DB のテストは skip します。
- TypeORM 0.2 と 1.x では、結合テストと同じ内容を手元で確かめています（devDependencies には 0.3 だけを入れています）。

## 版の出し方

1. 核の版を上げたときは、`dependencies` の `bi-dwh-query-core` のタグを上げて `npm install` します。
2. `package.json` の `version` を上げてコミットし、`v<版>` のタグを付けてプッシュします。
