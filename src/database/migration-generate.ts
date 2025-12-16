import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const migrationName = process.argv[2];

if (!migrationName) {
  console.error('❌ Por favor, forneça um nome para a migration:');
  console.log('   npm run migration:generate -- NomeDaMigration');
  process.exit(1);
}

// Validar nome da migration (sem espaços, apenas letras, números e underscore)
const sanitizedName = migrationName.replace(/[^a-zA-Z0-9_]/g, '_');
const timestamp = Date.now();
const className = `${sanitizedName}${timestamp}`;
const fileName = `${timestamp}-${sanitizedName}.ts`;
const filePath = `src/migrations/${fileName}`;

console.log(`📝 Criando migration: ${fileName}...`);

// Template básico de migration
const migrationTemplate = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adicione suas alterações aqui
    // Exemplo: await queryRunner.query(\`ALTER TABLE users ADD COLUMN newColumn VARCHAR(255)\`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Adicione a reversão aqui
    // Exemplo: await queryRunner.query(\`ALTER TABLE users DROP COLUMN newColumn\`);
  }
}
`;

try {
  // Criar diretório se não existir
  mkdirSync('src/migrations', { recursive: true });
  
  // Escrever arquivo
  writeFileSync(join(process.cwd(), filePath), migrationTemplate);
  
  console.log(`✅ Migration criada: ${filePath}`);
  console.log(`\n📝 Edite o arquivo e adicione suas alterações no método 'up()'`);
  console.log(`   E a reversão no método 'down()'`);
} catch (error: any) {
  console.error('❌ Erro ao criar migration:', error.message);
  process.exit(1);
}

