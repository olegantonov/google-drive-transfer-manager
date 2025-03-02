// ===================== CONFIGURAÇÕES GLOBAIS =====================

// Informe aqui o ID da planilha de banco de dados original
var DATABASE_SPREADSHEET_ID = "ID_PLANILHA";

// Nome da aba da planilha de banco de dados
var DB_SHEET_NAME = "Database";
// Cabeçalho esperado na planilha (a coluna 10, "TransferAccepted", será utilizada para registrar o aceite)
var DB_HEADERS = ["ID", "Title", "MimeType", "ParentID", "Path", "OwnerEmail", "OwnerName", "TagProcessed", "TransferProcessed", "TransferAccepted"];

/**
 * Retorna o nome da pasta padrão para os itens movidos, baseada no proprietário original.
 * @param {string} originalOwner 
 * @returns {string}
 */
function getDefaultFolderName(originalOwner) {
  return "Transferidos de " + originalOwner;
}

// ===================== FUNÇÕES AUXILIARES DE ACESSO À PLANILHA =====================

/**
 * Obtém ou abre a planilha de banco de dados utilizando o ID informado na constante DATABASE_SPREADSHEET_ID.
 * Garante o acesso à planilha específica, mesmo que ela seja de propriedade de outro usuário.
 * @returns {Sheet}
 */
function getDbSheet() {
  Logger.log("Utilizando o ID da planilha definido: " + DATABASE_SPREADSHEET_ID);
  var ss;
  try {
    ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
    Logger.log("Planilha Database aberta com sucesso.");
  } catch (e) {
    Logger.log("Erro ao acessar a planilha com ID " + DATABASE_SPREADSHEET_ID + ": " + e.message);
    throw new Error("Erro ao acessar a planilha Database: " + e.message);
  }
  
  var sheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!sheet) {
    Logger.log("A aba '" + DB_SHEET_NAME + "' não foi encontrada na planilha Database.");
    throw new Error("Aba '" + DB_SHEET_NAME + "' não encontrada na planilha Database.");
  } else {
    Logger.log("A aba '" + DB_SHEET_NAME + "' foi encontrada na planilha Database.");
  }
  return sheet;
}

/**
 * Atualiza a coluna "TransferAccepted" (coluna 10) na linha especificada.
 * @param {number} rowIndex - Índice da linha (1-indexado)
 * @param {string} acceptedStatus - Status do aceite ("Accepted" ou "Moved to Default Folder")
 */
function updateRowAccepted(rowIndex, acceptedStatus) {
  var sheet = getDbSheet();
  sheet.getRange(rowIndex, 10).setValue(acceptedStatus);
  Logger.log("Linha " + rowIndex + " atualizada com status: " + acceptedStatus);
}

// ===================== FUNÇÕES AUXILIARES DE MANIPULAÇÃO DE ITENS NO DRIVE =====================

/**
 * Tenta obter a pasta cujo ID é informado.
 * Retorna o objeto pasta se existir ou null, caso contrário.
 * @param {string} folderId 
 * @returns {Object|null}
 */
function getFolderIfExists(folderId) {
  try {
    var folder = Drive.Files.get(folderId, {fields:"id, title, owners"});
    Logger.log("Pasta encontrada: " + folder.title + " (ID: " + folderId + ")");
    return folder;
  } catch (e) {
    Logger.log("Não foi possível encontrar a pasta com ID " + folderId + ". Erro: " + e.message);
    return null;
  }
}

/**
 * Cria ou recupera na raiz uma pasta padrão com o nome "Transferidos de [originalOwner]".
 * Retorna o ID da pasta.
 * @param {string} originalOwner 
 * @returns {string}
 */
function getOrCreateDefaultFolder(originalOwner) {
  var folderName = getDefaultFolderName(originalOwner);
  Logger.log("Verificando existência da pasta padrão: " + folderName);
  var rootFolder = DriveApp.getRootFolder();
  var folders = rootFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    var folder = folders.next();
    Logger.log("Pasta padrão encontrada: " + folderName + " (ID: " + folder.getId() + ")");
    return folder.getId();
  } else {
    var newFolder = rootFolder.createFolder(folderName);
    Logger.log("Criada nova pasta padrão: " + folderName + " (ID: " + newFolder.getId() + ")");
    return newFolder.getId();
  }
}

/**
 * Move o item (arquivo ou pasta) para a pasta de destino.
 * Remove os pais atuais e adiciona a pasta de destino.
 * @param {string} itemId 
 * @param {string} newParentId 
 */
function moveItemToFolder(itemId, newParentId) {
  try {
    var file = Drive.Files.get(itemId, {fields:"parents, title"});
    var currentParents = [];
    if (file.parents) {
      for (var i = 0; i < file.parents.length; i++) {
        currentParents.push(file.parents[i].id);
      }
    }
    Logger.log("Movendo item '" + file.title + "' (ID: " + itemId + ") para a pasta com ID: " + newParentId);
    Drive.Files.update({}, itemId, null, {
      addParents: newParentId,
      removeParents: currentParents.join(',')
    });
    Logger.log("Item " + itemId + " movido com sucesso.");
  } catch (e) {
    Logger.log("Erro ao mover o item " + itemId + ": " + e.message);
    throw new Error("Erro ao mover o item " + itemId + ": " + e.message);
  }
}

/**
 * A partir da descrição do item (definida no processo de transferência original),
 * extrai o ID da pasta pai e o nome do proprietário original.
 * Exemplo de descrição:
 *    "ID da pasta: 12345ABC
 *     Caminho: Pasta1/Pasta2
 *     Proprietário antes da transferência: Fulano de Tal"
 * @param {string} description 
 * @returns {Object} { parentId: string, originalOwner: string }
 */
function parseDescription(description) {
  var result = { parentId: "", originalOwner: "" };
  if (!description) {
    Logger.log("Descrição vazia, não foi possível extrair informações.");
    return result;
  }
  var lines = description.split("\n");
  if (lines.length >= 1) {
    var m = lines[0].match(/ID da pasta:\s*(.+)/);
    if (m) {
      result.parentId = m[1].trim();
      Logger.log("Extraído ID da pasta da descrição: " + result.parentId);
    }
  }
  if (lines.length >= 3) {
    var m2 = lines[2].match(/Proprietário antes da transferência:\s*(.+)/);
    if (m2) {
      result.originalOwner = m2[1].trim();
      Logger.log("Extraído proprietário original da descrição: " + result.originalOwner);
    }
  }
  return result;
}

// ===================== MÓDULO DE ACEITE DAS TRANSFERÊNCIAS DE PASTAS =====================

/**
 * Para cada registro de pasta na planilha com transferência iniciada,
 * verifica se o destinatário já é o proprietário e atualiza a planilha.
 * Caso o pai indicado na descrição não exista ou não seja de propriedade do destinatário,
 * move a pasta para uma pasta padrão na raiz.
 */
function acceptFolderTransfers() {
  Logger.log("===== INICIANDO ACEITE DE TRANSFERÊNCIAS DE PASTAS =====");
  var sheet = getDbSheet();
  var data = sheet.getDataRange().getValues();
  var currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
  Logger.log("Usuário atual: " + currentUserEmail);
  
  // Itera a partir da linha 2 (ignorando o cabeçalho)
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var mimeType = row[2];
    var transferProcessed = (row[8] === "true" || row[8] === true);
    var transferAccepted = row[9];
    
    // Processa somente pastas que foram transferidas e que ainda não foram aceitas
    if (mimeType !== "application/vnd.google-apps.folder" || !transferProcessed || transferAccepted === "Accepted" || transferAccepted === "Moved to Default Folder") {
      Logger.log("Linha " + (i+1) + " ignorada: item não é pasta, não foi transferido ou já aceito.");
      continue;
    }
    
    try {
      Logger.log("Processando pasta na linha " + (i+1) + " com ID: " + id);
      var file = Drive.Files.get(id, {fields:"id, title, owners, description"});
      if (file.owners && file.owners.length > 0 && file.owners[0].emailAddress.toLowerCase() === currentUserEmail) {
        Logger.log("O usuário atual é o proprietário da pasta '" + file.title + "' (ID: " + id + ").");
        var parsed = parseDescription(file.description);
        var parentId = parsed.parentId;
        var originalOwner = parsed.originalOwner || row[6];
        var parentAcceptable = false;
        if (parentId && parentId !== "N/A") {
          var parentFolder = getFolderIfExists(parentId);
          if (parentFolder && parentFolder.owners && parentFolder.owners.length > 0 &&
              parentFolder.owners[0].emailAddress.toLowerCase() === currentUserEmail) {
            parentAcceptable = true;
            Logger.log("Pasta pai '" + parentFolder.title + "' (ID: " + parentId + ") é do usuário atual.");
          } else {
            Logger.log("Pasta pai com ID " + parentId + " não pertence ao usuário atual ou não existe.");
          }
        } else {
          Logger.log("Nenhum ID de pasta pai válido encontrado na descrição.");
        }
        if (!parentAcceptable) {
          var defaultFolderId = getOrCreateDefaultFolder(originalOwner);
          moveItemToFolder(id, defaultFolderId);
          updateRowAccepted(i + 1, "Moved to Default Folder");
        } else {
          updateRowAccepted(i + 1, "Accepted");
        }
      } else {
        Logger.log("Pasta " + row[1] + " (ID: " + id + ") ainda não foi transferida para o usuário atual.");
      }
    } catch (e) {
      Logger.log("Erro ao processar a pasta (linha " + (i+1) + ", ID: " + id + "): " + e.message);
    }
  }
  Logger.log("===== ACEITE DE TRANSFERÊNCIAS DE PASTAS CONCLUÍDO =====");
}

// ===================== MÓDULO DE ACEITE DAS TRANSFERÊNCIAS DE ARQUIVOS =====================

/**
 * Para cada registro de arquivo na planilha com transferência iniciada,
 * verifica se o destinatário já é o proprietário e atualiza a planilha.
 * Se o pai indicado na descrição não existir ou não pertencer ao destinatário,
 * move o arquivo para a pasta padrão na raiz.
 */
function acceptFileTransfers() {
  Logger.log("===== INICIANDO ACEITE DE TRANSFERÊNCIAS DE ARQUIVOS =====");
  var sheet = getDbSheet();
  var data = sheet.getDataRange().getValues();
  var currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
  Logger.log("Usuário atual: " + currentUserEmail);
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var mimeType = row[2];
    var transferProcessed = (row[8] === "true" || row[8] === true);
    var transferAccepted = row[9];
    
    // Processa somente arquivos (não pastas) que foram transferidos mas ainda não aceitos
    if (mimeType === "application/vnd.google-apps.folder" || !transferProcessed || transferAccepted === "Accepted" || transferAccepted === "Moved to Default Folder") {
      Logger.log("Linha " + (i+1) + " ignorada: item é pasta ou não foi transferido ou já aceito.");
      continue;
    }
    
    try {
      Logger.log("Processando arquivo na linha " + (i+1) + " com ID: " + id);
      var file = Drive.Files.get(id, {fields:"id, title, owners, description, parents"});
      if (file.owners && file.owners.length > 0 && file.owners[0].emailAddress.toLowerCase() === currentUserEmail) {
        Logger.log("O usuário atual é o proprietário do arquivo '" + file.title + "' (ID: " + id + ").");
        var parsed = parseDescription(file.description);
        var parentId = parsed.parentId;
        var originalOwner = parsed.originalOwner || row[6];
        var parentAcceptable = false;
        if (parentId && parentId !== "N/A") {
          var parentFolder = getFolderIfExists(parentId);
          if (parentFolder && parentFolder.owners && parentFolder.owners.length > 0 &&
              parentFolder.owners[0].emailAddress.toLowerCase() === currentUserEmail) {
            parentAcceptable = true;
            Logger.log("Pasta pai '" + parentFolder.title + "' (ID: " + parentId + ") é do usuário atual.");
          } else {
            Logger.log("Pasta pai com ID " + parentId + " não pertence ao usuário atual ou não existe.");
          }
        } else {
          Logger.log("Nenhum ID de pasta pai válido encontrado na descrição.");
        }
        if (!parentAcceptable) {
          var defaultFolderId = getOrCreateDefaultFolder(originalOwner);
          var currentParents = [];
          if (file.parents) {
            for (var j = 0; j < file.parents.length; j++) {
              currentParents.push(file.parents[j].id);
            }
          }
          Logger.log("Movendo arquivo '" + file.title + "' (ID: " + id + ") para a pasta padrão (ID: " + defaultFolderId + ").");
          Drive.Files.update({}, id, null, {
            addParents: defaultFolderId,
            removeParents: currentParents.join(',')
          });
          Logger.log("Arquivo " + id + " movido com sucesso.");
          updateRowAccepted(i + 1, "Moved to Default Folder");
        } else {
          updateRowAccepted(i + 1, "Accepted");
        }
      } else {
        Logger.log("Arquivo " + row[1] + " (ID: " + id + ") ainda não foi transferido para o usuário atual.");
      }
    } catch (e) {
      Logger.log("Erro ao processar o arquivo (linha " + (i+1) + ", ID: " + id + "): " + e.message);
    }
  }
  Logger.log("===== ACEITE DE TRANSFERÊNCIAS DE ARQUIVOS CONCLUÍDO =====");
}
