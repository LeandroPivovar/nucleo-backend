import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const myDataSource = new DataSource({
    type: "mysql",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    username: process.env.DB_USER || "nucleo",
    password: process.env.DB_PASSWORD || "nUcLeo@2026",
    database: process.env.DB_NAME || "nucleo2",
    entities: ["src/**/*.entity.ts"],
});

myDataSource.initialize().then(async () => {
    console.log("Data Source has been initialized!");
    const sales = await myDataSource.query('SELECT id, productId, customerName, totalValue, channel FROM sales ORDER BY id DESC LIMIT 10');
    console.log("Last 10 sales:", sales);

    const topProducts = await myDataSource.query('SELECT p.id, p.name, SUM(s.quantity) as vendas FROM sales s LEFT JOIN products p ON s.productId = p.id GROUP BY p.id, p.name ORDER BY vendas DESC LIMIT 5');
    console.log("Top products joined from sales:", topProducts);

    process.exit(0);
}).catch((err) => {
    console.error("Error during Data Source initialization", err);
    process.exit(1);
});
