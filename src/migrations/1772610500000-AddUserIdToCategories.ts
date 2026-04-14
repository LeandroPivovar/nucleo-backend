import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from "typeorm";

export class AddUserIdToCategories1772610500000 implements MigrationInterface {
    name = 'AddUserIdToCategories1772610500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasUserId = await queryRunner.hasColumn("categories", "userId");
        if (hasUserId) {
            return;
        }

        // Obter um ID de usuário padrão para associar as categorias existentes (ex: o primeiro usuário administrador)
        // Se a tabela de usuários estiver vazia, usa 1 como fallback.
        const defaultUser = await queryRunner.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
        const fallbackUserId = defaultUser && defaultUser.length > 0 ? defaultUser[0].id : 1;

        // Adicionar a coluna userId permitindo NULL primeiro
        await queryRunner.addColumn("categories", new TableColumn({
            name: "userId",
            type: "int",
            isNullable: true,
        }));

        // Atualizar todas as categorias existentes com o ID do usuário padrão
        await queryRunner.query(`UPDATE categories SET userId = ${fallbackUserId} WHERE userId IS NULL`);

        // Alterar a coluna para NOT NULL
        await queryRunner.changeColumn("categories", "userId", new TableColumn({
            name: "userId",
            type: "int",
            isNullable: false,
        }));

        // Adicionar a Foreign Key
        await queryRunner.createForeignKey("categories", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE",
            onUpdate: "CASCADE"
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("categories");
        if (table) {
            const foreignKey = table.foreignKeys.find(fk => fk.columnNames.indexOf("userId") !== -1);
            if (foreignKey) {
                await queryRunner.dropForeignKey("categories", foreignKey);
            }
        }
        await queryRunner.dropColumn("categories", "userId");
    }
}
