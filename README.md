# Google Drive Transfer Manager

Este projeto automatiza o processo de transferência e aceite de arquivos e pastas no Google Drive utilizando **Google Apps Script**.

## 📌 Funcionalidades
- Garante que arquivos e pastas transferidos sejam movidos corretamente para o novo proprietário.
- Verifica a posse dos itens e move-os para a pasta padrão, se necessário.
- Atualiza automaticamente um banco de dados no Google Sheets para rastreamento da transferência.

## 🛠️ Tecnologias Utilizadas
- **Google Apps Script**
- **Google Drive API**
- **Google Sheets API**

## 🚀 Como Usar
1. Configure o **ID da planilha de banco de dados** em `src/transfer_manager.js`:
   ```js
   var DATABASE_SPREADSHEET_ID = "SEU_ID_AQUI";
2. Faça o deploy do script no Google Apps Script e conceda as permissões necessárias.
3. Execute as funções acceptFolderTransfers() e acceptFileTransfers() conforme necessário.
