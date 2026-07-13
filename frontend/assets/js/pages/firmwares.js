'use strict';

const FirmwaresPage = (() => {
  let activeTab = 'archivos';
  let firmwares = [];
  let inventoryData = [];
  let acciones = [];
  let currentPage = 1;
  let inventoryLimit = 10;
  let editingActionId = null;

  function render() {
    const container = document.getElementById('page-content');
    container.innerHTML = `
      <div class="page-title">Firmwares</div>
      <div class="tabs-container">
        <button class="tab-btn active" data-tab="archivos">Archivos</button>
        <button class="tab-btn" data-tab="inventario">Inventario</button>
        <button class="tab-btn" data-tab="acciones">Acciones</button>
      </div>

      <div class="tab-content">
        <div id="archivos-tab" class="tab-pane active">
          <div class="archivos-section">
            <div class="section-header">
              <h3>Gestionar Archivos de Firmware</h3>
              <button class="btn btn-primary" id="upload-new-btn">+ Nuevo Firmware</button>
            </div>
            <div id="upload-form" class="upload-form hidden">
              <form id="firmware-form">
                <div class="form-grid">
                  <div class="form-group">
                    <label for="oui">OUI</label>
                    <input type="text" id="oui" name="oui" placeholder="ej: AABBCCDDEE" />
                  </div>
                  <div class="form-group">
                    <label for="modelo">Modelo *</label>
                    <input type="text" id="modelo" name="modelo" placeholder="ej: HGU110" required />
                  </div>
                  <div class="form-group">
                    <label for="version">Versión *</label>
                    <input type="text" id="version" name="version" placeholder="ej: 1.0.0" required />
                  </div>
                </div>

                <div class="form-group">
                  <label>Archivo *</label>
                  <div class="upload-options">
                    <div class="option">
                      <label class="radio-label">
                        <input type="radio" name="upload-type" value="file" checked />
                        Desde computadora
                      </label>
                      <input type="file" id="file-input" name="file" accept=".bin,.img,.zip,.tar,.gz" required />
                    </div>
                    <div class="option">
                      <label class="radio-label">
                        <input type="radio" name="upload-type" value="url" />
                        Desde URL
                      </label>
                      <input type="text" id="url-input" name="url" placeholder="https://..." disabled />
                    </div>
                  </div>
                </div>

                <div class="form-actions">
                  <button type="submit" class="btn btn-primary">Guardar Firmware</button>
                  <button type="button" class="btn btn-ghost" id="cancel-btn">Cancelar</button>
                </div>
              </form>
            </div>

            <div id="firmwares-table" class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>OUI</th>
                    <th>Modelo</th>
                    <th>Versión</th>
                    <th>Archivo</th>
                    <th>Tamaño</th>
                    <th>Fecha</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody id="firmwares-tbody">
                  <tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">Cargando...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="inventario-tab" class="tab-pane">
          <div class="inventario-section">
            <div class="section-header">
              <h3>Inventario de Dispositivos</h3>
              <div class="pagination-controls">
                <button class="btn btn-sm btn-ghost" id="prev-page-btn" disabled>← Anterior</button>
                <span id="page-info" style="margin:0 1rem;font-size:0.9rem">Página 1</span>
                <button class="btn btn-sm btn-ghost" id="next-page-btn">Siguiente →</button>
              </div>
            </div>
            <div id="inventory-table" class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Model</th>
                    <th>HW Version</th>
                    <th>SW Version</th>
                    <th>Count</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody id="inventory-tbody">
                  <tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">Cargando inventario...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="acciones-tab" class="tab-pane">
          <div class="acciones-section">
            <div class="section-header">
              <h3>Acciones de Actualización</h3>
            </div>
            <div id="acciones-table" class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Fabricante</th>
                    <th>Modelo</th>
                    <th>HW Version</th>
                    <th>SW Version</th>
                    <th>Archivo</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody id="acciones-tbody">
                  <tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">Cargando acciones...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div id="rule-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Crear Acción</h3>
            <button class="modal-close" id="modal-close-btn">&times;</button>
          </div>
          <form id="rule-form">
            <div class="form-grid">
              <div class="form-group">
                <label>Fabricante *</label>
                <input type="text" id="rule-vendor" name="vendor" readonly />
              </div>
              <div class="form-group">
                <label>Modelo *</label>
                <input type="text" id="rule-model" name="model" readonly />
              </div>
              <div class="form-group">
                <label>Versión de Hardware *</label>
                <input type="text" id="rule-hw-version" name="hwVersion" readonly />
              </div>
              <div class="form-group">
                <label>Versión de Software *</label>
                <input type="text" id="rule-sw-version" name="swVersion" readonly />
              </div>
            </div>
            <div class="form-group">
              <label for="rule-firmware-id">Nombre del archivo *</label>
              <select id="rule-firmware-id" name="firmwareId" required>
                <option value="">-- Seleccionar firmware --</option>
              </select>
            </div>
            <div class="form-group" style="margin-top:1.5rem;">
              <label class="checkbox-label">
                <input type="checkbox" id="rule-confirm" name="confirm" required />
                Confirmo que quiero crear esta acción, la cual afectará a <strong id="rule-device-count">0</strong> dispositivos
              </label>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Crear Acción</button>
              <button type="button" class="btn btn-ghost" id="modal-cancel-btn">Cancelar</button>
            </div>
          </form>
        </div>
      </div>

      <div id="edit-action-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Editar Acción</h3>
            <button class="modal-close" id="edit-modal-close-btn">&times;</button>
          </div>
          <form id="edit-action-form">
            <div class="form-grid">
              <div class="form-group">
                <label>Fabricante</label>
                <input type="text" id="edit-vendor" readonly />
              </div>
              <div class="form-group">
                <label>Modelo</label>
                <input type="text" id="edit-model" readonly />
              </div>
              <div class="form-group">
                <label>HW Version</label>
                <input type="text" id="edit-hw-version" readonly />
              </div>
              <div class="form-group">
                <label>SW Version</label>
                <input type="text" id="edit-sw-version" readonly />
              </div>
            </div>
            <div class="form-group">
              <label for="edit-firmware-id">Nombre del archivo *</label>
              <select id="edit-firmware-id" required>
                <option value="">-- Seleccionar firmware --</option>
              </select>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Cambios</button>
              <button type="button" class="btn btn-ghost" id="edit-modal-cancel-btn">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;

    setupEventListeners();
    loadFirmwares();
  }

  function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        switchTab(tab);
        // Load inventory when switching to that tab
        if (tab === 'inventario' && inventoryData.length === 0) {
          loadInventory();
        }
        // Load actions when switching to that tab
        if (tab === 'acciones') {
          loadActions();
        }
      });
    });

    // Upload form toggle
    document.getElementById('upload-new-btn').addEventListener('click', () => {
      document.getElementById('upload-form').classList.toggle('hidden');
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      document.getElementById('upload-form').classList.add('hidden');
      document.getElementById('firmware-form').reset();
    });

    // Upload type radio
    document.querySelectorAll('input[name="upload-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const isFile = e.target.value === 'file';
        document.getElementById('file-input').disabled = !isFile;
        document.getElementById('url-input').disabled = isFile;
      });
    });

    // Form submission
    document.getElementById('firmware-form').addEventListener('submit', handleFirmwareSubmit);

    // Inventory pagination
    if (document.getElementById('prev-page-btn')) {
      document.getElementById('prev-page-btn').addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          renderInventoryTable();
        }
      });
      document.getElementById('next-page-btn').addEventListener('click', () => {
        const maxPages = Math.ceil(inventoryData.length / inventoryLimit);
        if (currentPage < maxPages) {
          currentPage++;
          renderInventoryTable();
        }
      });
    }

    // Rule modal
    const ruleModal = document.getElementById('rule-modal');
    document.getElementById('modal-close-btn').addEventListener('click', () => {
      ruleModal.classList.add('hidden');
      document.getElementById('rule-form').reset();
    });
    document.getElementById('modal-cancel-btn').addEventListener('click', () => {
      ruleModal.classList.add('hidden');
      document.getElementById('rule-form').reset();
    });
    ruleModal.addEventListener('click', (e) => {
      if (e.target === ruleModal) {
        ruleModal.classList.add('hidden');
        document.getElementById('rule-form').reset();
      }
    });
    document.getElementById('rule-form').addEventListener('submit', handleRuleSubmit);

    // Edit action modal
    const editModal = document.getElementById('edit-action-modal');
    document.getElementById('edit-modal-close-btn').addEventListener('click', () => {
      editModal.classList.add('hidden');
      document.getElementById('edit-action-form').reset();
    });
    document.getElementById('edit-modal-cancel-btn').addEventListener('click', () => {
      editModal.classList.add('hidden');
      document.getElementById('edit-action-form').reset();
    });
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) {
        editModal.classList.add('hidden');
        document.getElementById('edit-action-form').reset();
      }
    });
    document.getElementById('edit-action-form').addEventListener('submit', handleEditActionSubmit);
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `${tab}-tab`);
    });
  }

  async function loadFirmwares() {
    try {
      firmwares = await API.get('/firmwares');
      renderFirmwaresTable();
    } catch (err) {
      console.error('Error loading firmwares:', err);
      document.getElementById('firmwares-tbody').innerHTML =
        `<tr><td colspan="7" style="text-align:center;color:var(--color-error)">Error al cargar firmwares</td></tr>`;
    }
  }

  function renderFirmwaresTable() {
    const tbody = document.getElementById('firmwares-tbody');
    if (firmwares.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">No hay firmwares cargados</td></tr>`;
      return;
    }

    tbody.innerHTML = firmwares.map(fw => {
      const createdAt = Config.formatDate(new Date(fw.created_at));
      const sizeKB = (fw.file_size / 1024).toFixed(2);
      return `
        <tr>
          <td>${fw.oui}</td>
          <td>${fw.modelo}</td>
          <td>${fw.version}</td>
          <td>${fw.file_name}</td>
          <td>${sizeKB} KB</td>
          <td>${createdAt}</td>
          <td>
            <button class="btn btn-sm btn-ghost" onclick="FirmwaresPage.deleteFirmware('${fw.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function handleFirmwareSubmit(e) {
    e.preventDefault();

    const oui = document.getElementById('oui').value.trim();
    const modelo = document.getElementById('modelo').value.trim();
    const version = document.getElementById('version').value.trim();
    const uploadType = document.querySelector('input[name="upload-type"]:checked').value;

    if (!modelo || !version) {
      alert('Por favor completa Modelo y Versión');
      return;
    }

    try {
      if (uploadType === 'file') {
        await uploadFromFile(oui, modelo, version);
      } else {
        const url = document.getElementById('url-input').value.trim();
        if (!url) {
          alert('Por favor proporciona una URL válida');
          return;
        }
        await uploadFromURL(oui, modelo, version, url);
      }

      document.getElementById('firmware-form').reset();
      document.getElementById('upload-form').classList.add('hidden');
      await loadFirmwares();
      alert('Firmware guardado correctamente');
    } catch (err) {
      console.error('Error uploading firmware:', err);
      alert(`Error: ${err.message}`);
    }
  }

  async function uploadFromFile(oui, modelo, version) {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!file) {
      throw new Error('Selecciona un archivo');
    }

    const formData = new FormData();
    formData.append('oui', oui);
    formData.append('modelo', modelo);
    formData.append('version', version);
    formData.append('file', file);

    const response = await fetch('/api/firmwares/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
      body: formData,
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
  }

  async function uploadFromURL(oui, modelo, version, url) {
    const response = await API.post('/firmwares/upload-url', {
      oui,
      modelo,
      version,
      url
    });
    return response;
  }

  function deleteFirmware(id) {
    if (!confirm('¿Eliminar este firmware?')) return;

    API.delete(`/firmwares/${id}`)
      .then(() => loadFirmwares())
      .catch(err => alert(`Error al eliminar: ${err.message}`));
  }

  async function loadInventory() {
    try {
      const response = await API.get(`/firmwares/inventory/list?page=1&limit=100`);
      inventoryData = response.data || [];
      currentPage = 1;
      renderInventoryTable();
    } catch (err) {
      console.error('Error loading inventory:', err);
      document.getElementById('inventory-tbody').innerHTML =
        `<tr><td colspan="6" style="text-align:center;color:var(--color-error)">Error al cargar inventario</td></tr>`;
    }
  }

  function renderInventoryTable() {
    const tbody = document.getElementById('inventory-tbody');
    const offset = (currentPage - 1) * inventoryLimit;
    const paginatedData = inventoryData.slice(offset, offset + inventoryLimit);
    const maxPages = Math.ceil(inventoryData.length / inventoryLimit);

    if (paginatedData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">No hay dispositivos</td></tr>`;
      document.getElementById('prev-page-btn').disabled = true;
      document.getElementById('next-page-btn').disabled = true;
      return;
    }

    tbody.innerHTML = paginatedData.map(item => `
      <tr>
        <td>${item.vendor}</td>
        <td>${item.model}</td>
        <td>${item.hwVersion}</td>
        <td>${item.swVersion}</td>
        <td><strong>${item.count}</strong></td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="FirmwaresPage.openRuleModal('${item.vendor.replace(/'/g, "\\'")}', '${item.model.replace(/'/g, "\\'")}', '${item.hwVersion.replace(/'/g, "\\'")}', '${item.swVersion.replace(/'/g, "\\'")}', ${item.count})">Crear Acción</button>
        </td>
      </tr>
    `).join('');

    // Update pagination controls
    document.getElementById('prev-page-btn').disabled = currentPage <= 1;
    document.getElementById('next-page-btn').disabled = currentPage >= maxPages;
    document.getElementById('page-info').textContent = `Página ${currentPage} de ${maxPages} (Total: ${inventoryData.length})`;
  }

  async function openRuleModal(vendor, model, hwVersion, swVersion, deviceCount) {
    // Pre-fill form fields
    document.getElementById('rule-vendor').value = vendor;
    document.getElementById('rule-model').value = model;
    document.getElementById('rule-hw-version').value = hwVersion;
    document.getElementById('rule-sw-version').value = swVersion;
    document.getElementById('rule-device-count').textContent = deviceCount;
    document.getElementById('rule-confirm').checked = false;

    // Load compatible firmwares
    await loadCompatibleFirmwares(vendor, model);

    // Show modal
    document.getElementById('rule-modal').classList.remove('hidden');
  }

  async function loadCompatibleFirmwares(vendor, model) {
    try {
      const compatibleFws = await API.get(`/firmwares/rules/compatible?vendor=${encodeURIComponent(vendor)}&model=${encodeURIComponent(model)}`);
      const select = document.getElementById('rule-firmware-id');
      select.innerHTML = '<option value="">-- Seleccionar firmware --</option>';

      if (compatibleFws && compatibleFws.length > 0) {
        compatibleFws.forEach(fw => {
          const option = document.createElement('option');
          option.value = fw.id;
          option.textContent = `${fw.file_name} (v${fw.version})`;
          select.appendChild(option);
        });
      } else {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'No hay firmwares disponibles para este modelo';
        select.appendChild(option);
      }
    } catch (err) {
      console.error('Error loading compatible firmwares:', err);
      const select = document.getElementById('rule-firmware-id');
      select.innerHTML = '<option value="">Error al cargar firmwares</option>';
    }
  }

  async function handleRuleSubmit(e) {
    e.preventDefault();

    const vendor = document.getElementById('rule-vendor').value;
    const model = document.getElementById('rule-model').value;
    const hwVersion = document.getElementById('rule-hw-version').value;
    const swVersion = document.getElementById('rule-sw-version').value;
    const firmwareId = document.getElementById('rule-firmware-id').value;
    const confirm = document.getElementById('rule-confirm').checked;

    if (!firmwareId) {
      alert('Por favor selecciona un firmware');
      return;
    }

    if (!confirm) {
      alert('Por favor confirma que deseas crear esta regla');
      return;
    }

    try {
      // Find the firmware file name
      const selectedOption = document.querySelector('#rule-firmware-id option:checked');
      const firmwareFile = selectedOption.textContent.split(' (')[0];

      const response = await API.post('/firmwares/rules', {
        vendor,
        model,
        hwVersion,
        swVersion,
        firmwareId,
        firmwareFile
      });

      document.getElementById('rule-modal').classList.add('hidden');
      document.getElementById('rule-form').reset();
      alert('Regla creada correctamente');

      // Reload rules if needed (future implementation)
    } catch (err) {
      console.error('Error creating rule:', err);
      alert(`Error: ${err.message}`);
    }
  }

  async function loadActions() {
    try {
      acciones = await API.get('/firmwares/rules/list');
      renderActionsTable();
    } catch (err) {
      console.error('Error loading actions:', err);
      document.getElementById('acciones-tbody').innerHTML =
        `<tr><td colspan="7" style="text-align:center;color:var(--color-error)">Error al cargar acciones</td></tr>`;
    }
  }

  function renderActionsTable() {
    const tbody = document.getElementById('acciones-tbody');
    if (!acciones || acciones.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">No hay acciones creadas</td></tr>`;
      return;
    }

    tbody.innerHTML = acciones.map(action => {
      const statusBadgeClass = action.status === 'pending' ? 'badge-orange' :
                              action.status === 'active' ? 'badge-online' : 'badge-offline';
      const statusText = action.status === 'pending' ? 'Pendiente' :
                        action.status === 'active' ? 'Activa' : 'Deshabilitada';

      const actionButton = action.status === 'pending'
        ? `<button class="btn btn-sm btn-primary" onclick="FirmwaresPage.activateAction('${action.id}')">Activar</button>`
        : `<button class="btn btn-sm btn-ghost" onclick="FirmwaresPage.deactivateAction('${action.id}')">Desactivar</button>`;

      return `
        <tr>
          <td>${action.vendor}</td>
          <td>${action.model}</td>
          <td>${action.hw_version}</td>
          <td>${action.sw_version}</td>
          <td>${action.firmware_file}</td>
          <td><span class="badge ${statusBadgeClass}">${statusText}</span></td>
          <td style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn btn-sm btn-ghost" onclick="FirmwaresPage.openEditActionModal('${action.id}')" ${action.status === 'active' ? 'disabled' : ''}>Editar</button>
            ${actionButton}
            <button class="btn btn-sm btn-danger" onclick="FirmwaresPage.deleteAction('${action.id}')" ${action.status === 'active' ? 'disabled' : ''}>Borrar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function openEditActionModal(actionId) {
    try {
      // Find the action in the acciones array
      const action = acciones.find(a => a.id === actionId);
      if (!action) {
        alert('Acción no encontrada');
        return;
      }

      editingActionId = actionId;

      // Pre-fill form
      document.getElementById('edit-vendor').value = action.vendor;
      document.getElementById('edit-model').value = action.model;
      document.getElementById('edit-hw-version').value = action.hw_version;
      document.getElementById('edit-sw-version').value = action.sw_version;

      // Load compatible firmwares
      await loadCompatibleFirmwaresForEdit(action.vendor, action.model);

      // Set current firmware as selected
      document.getElementById('edit-firmware-id').value = action.firmware_id;

      // Show modal
      document.getElementById('edit-action-modal').classList.remove('hidden');
    } catch (err) {
      console.error('Error opening edit modal:', err);
      alert('Error al abrir el formulario de edición');
    }
  }

  async function loadCompatibleFirmwaresForEdit(vendor, model) {
    try {
      const compatibleFws = await API.get(`/firmwares/rules/compatible?vendor=${encodeURIComponent(vendor)}&model=${encodeURIComponent(model)}`);
      const select = document.getElementById('edit-firmware-id');
      select.innerHTML = '<option value="">-- Seleccionar firmware --</option>';

      if (compatibleFws && compatibleFws.length > 0) {
        compatibleFws.forEach(fw => {
          const option = document.createElement('option');
          option.value = fw.id;
          option.textContent = `${fw.file_name} (v${fw.version})`;
          select.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Error loading firmwares:', err);
    }
  }

  async function handleEditActionSubmit(e) {
    e.preventDefault();

    if (!editingActionId) {
      alert('Error: Acción no identificada');
      return;
    }

    const firmwareId = document.getElementById('edit-firmware-id').value;
    const selectedOption = document.querySelector('#edit-firmware-id option:checked');
    const firmwareFile = selectedOption.textContent.split(' (')[0];

    if (!firmwareId) {
      alert('Por favor selecciona un firmware');
      return;
    }

    try {
      await API.patch(`/firmwares/rules/${editingActionId}`, {
        firmwareId,
        firmwareFile
      });

      document.getElementById('edit-action-modal').classList.add('hidden');
      document.getElementById('edit-action-form').reset();
      editingActionId = null;
      alert('Acción actualizada correctamente');
      await loadActions();
    } catch (err) {
      console.error('Error updating action:', err);
      alert(`Error: ${err.message}`);
    }
  }

  async function activateAction(actionId) {
    if (!confirm('⚠️ Activar esta acción impactará a todos los dispositivos con este Fabricante/Modelo. ¿Continuar?')) return;

    try {
      await API.patch(`/firmwares/rules/${actionId}/activate`, {});
      alert('Acción activada. El sistema comenzará a monitorear y aplicar actualizaciones.');
      await loadActions();
    } catch (err) {
      console.error('Error activating action:', err);
      alert(`Error: ${err.message}`);
    }
  }

  async function deactivateAction(actionId) {
    if (!confirm('¿Desactivar esta acción?')) return;

    try {
      await API.patch(`/firmwares/rules/${actionId}/deactivate`, {});
      alert('Acción desactivada');
      await loadActions();
    } catch (err) {
      console.error('Error deactivating action:', err);
      alert(`Error: ${err.message}`);
    }
  }

  async function deleteAction(actionId) {
    if (!confirm('¿Eliminar esta acción?')) return;

    try {
      await API.delete(`/firmwares/rules/${actionId}`);
      alert('Acción eliminada correctamente');
      await loadActions();
    } catch (err) {
      console.error('Error deleting action:', err);
      alert(`Error: ${err.message}`);
    }
  }

  return { render, deleteFirmware, openRuleModal, openEditActionModal, activateAction, deactivateAction, deleteAction };
})();
