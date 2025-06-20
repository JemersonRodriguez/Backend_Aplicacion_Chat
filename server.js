import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mysql from 'mysql2/promise';
import mssql from 'mssql';

dotenvConfig();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Configuración MySQL
const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'chatdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Configuración SQL Server
const sqlServerConfig = {
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || '',
  server: process.env.MSSQL_HOST || 'localhost',
  database: process.env.MSSQL_DATABASE || 'chatdb',
  options: {
    trustServerCertificate: true
  }
};

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('chat_message', async (msg) => {
    try {
      // Iniciar transacción en ambas bases de datos
      const mysqlConn = await mysqlPool.getConnection();
      const mssqlPool = await mssql.connect(sqlServerConfig);
      const mssqlTx = new mssql.Transaction(mssqlPool);

      await mysqlConn.beginTransaction();
      await mssqlTx.begin();

      try {
        // Insertar en MySQL
        await mysqlConn.query('INSERT INTO mensajes (mensaje) VALUES (?)', [msg]);

        // Insertar en SQL Server
        await mssqlTx.request()
          .input('mensaje', mssql.NVarChar, msg)
          .query('INSERT INTO mensajes (mensaje) VALUES (@mensaje)');

        // Commit en ambas
        await mysqlConn.commit();
        await mssqlTx.commit();

        // Emitir mensaje a todos los clientes
        io.emit('chat_message', msg);
      } catch (err) {
        await mysqlConn.rollback();
        await mssqlTx.rollback();
        console.error('Error en transacción:', err);
        socket.emit('error_message', 'Error al guardar el mensaje');
      } finally {
        mysqlConn.release();
        mssqlPool.close();
      }
    } catch (err) {
      console.error('Error de conexión:', err);
      socket.emit('error_message', 'Error de conexión a la base de datos');
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
