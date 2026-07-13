# Revisión de Seguridad y Mejoras - MOCA ACS

**Fecha:** 2026-04-17  
**Estado:** Revisión completa completada

---

## ✅ Fortalezas Identificadas

### Autenticación y Autorización
- ✓ JWT con expiración de 8 horas
- ✓ Sesiones almacenadas en BD con hash SHA256
- ✓ Middleware de autenticación y autorización correctamente implementado
- ✓ Protección contra auto-eliminación y auto-desactivación de usuarios

### Manejo de Datos Sensibles
- ✓ Contraseñas hasheadas con bcryptjs (salt rounds: 10)
- ✓ Prepared statements para prevenir SQL injection
- ✓ Validación de roles (enum: admin|viewer)

### API Security
- ✓ CORS habilitado
- ✓ Content-Type: application/json
- ✓ Timeout de 30 segundos en llamadas a GenieACS
- ✓ Logging de auditoría en operaciones críticas

---

## ⚠️ Problemas Identificados y Soluciones

### 1. **JWT_SECRET por defecto inseguro (CRÍTICO en producción)**
**Archivo:** `backend/src/config/jwt.js`  
**Problema:**
```javascript
const SECRET = process.env.JWT_SECRET || 'dev-secret-inseguro';
```
**Riesgo:** En producción, si JWT_SECRET no está configurado, se usa una contraseña débil.  
**Solución:** Agregar validación al inicio que lance error si no está configurado en producción.

**Acción recomendada:** Crear variable de entorno obligatoria
```javascript
const SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET debe estar configurado en producción');
  }
  return 'dev-secret-inseguro';
})();
```

---

### 2. **Validación de proyecciones en GenieACS (SEGURIDAD)**
**Archivo:** `backend/src/routes/devices.js` (línea 17)  
**Problema:**
```javascript
if (req.query.projection) params.projection = req.query.projection;
```
**Riesgo:** El usuario puede pasar una proyección arbitraria directamente a GenieACS.  
**Impacto:** Bajo (solo lectura), pero permite consumo excesivo de datos.

**Solución:** Whitelist de proyecciones permitidas
```javascript
const ALLOWED_PROJECTIONS = [
  'InternetGatewayDevice.DeviceInfo.ModelName',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
  '_lastInform'
];

if (req.query.projection) {
  const proj = req.query.projection;
  if (!ALLOWED_PROJECTIONS.includes(proj)) {
    return res.status(400).json({ error: 'Proyección no permitida' });
  }
  params.projection = proj;
}
```

---

### 3. **Validación de ID de dispositivo (SEGURIDAD)**
**Archivo:** `backend/src/routes/devices.js` (línea 29)  
**Problema:**
```javascript
const query = JSON.stringify({ _id: req.params.id });
```
**Riesgo:** Inyección de parámetros en query a GenieACS (bajo riesgo por JSON.stringify).  
**Solución:** Validar que el ID cumple patrón esperado (alfanumérico, guiones, puntos)
```javascript
const deviceId = req.params.id;
if (!/^[a-zA-Z0-9\-.:_]+$/.test(deviceId)) {
  return res.status(400).json({ error: 'ID de dispositivo inválido' });
}
const query = JSON.stringify({ _id: deviceId });
```

---

### 4. **Validación de email en perfil de usuario (MEJORA)**
**Archivo:** `backend/src/routes/users.js` (línea 97-100)  
**Problema:**
```javascript
if (correo !== undefined) {
  updates.push('correo = ?');
  values.push(correo || '');
}
```
**Riesgo:** No valida que sea un email válido.  
**Solución:** Agregar validación simple
```javascript
if (correo !== undefined) {
  if (correo && !correo.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  updates.push('correo = ?');
  values.push(correo || '');
}
```

---

### 5. **Rate limiting en login (MEJORA)**
**Archivo:** `backend/src/routes/auth.js`  
**Problema:** No hay limitación de intentos de login fallidos.  
**Riesgo:** Permite ataque de fuerza bruta contra contraseñas.  
**Solución:** Implementar rate limiting (recomendado: express-rate-limit)
```bash
npm install express-rate-limit
```
```javascript
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: 'Demasiados intentos de login, intenta más tarde'
});

router.post('/login', loginLimiter, (req, res) => { ... });
```

---

### 6. **Error handling excesivamente vago en users.js (MEJORA)**
**Archivo:** `backend/src/routes/users.js` (línea 34)  
**Problema:**
```javascript
catch {
  res.status(409).json({ error: 'El username ya existe' });
}
```
**Riesgo:** Captura CUALQUIER error pero solo reporta "username existe". Otros errores se ocultan.  
**Solución:** Diferenciar errores
```javascript
catch (err) {
  if (err.message.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'El username ya existe' });
  } else {
    console.error('Error creando usuario:', err.message);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
}
```

---

### 7. **Logging sensible - no exponer detalles internos (MEJORA)**
**Archivos afectados:** Toda la aplicación  
**Problema:** Algunos logs incluyen información sensible (errores internos, detalles de DB).  
**Solución:** Usar un logger estructurado
```bash
npm install pino
```
Configurar niveles de log apropiados y no exponer stacktraces en respuestas HTTP a usuarios.

---

## 📋 Recomendaciones de Implementación (Por Prioridad)

### 🔴 CRÍTICA (Implementar antes de producción)
1. **JWT_SECRET validation** - Asegurar que está configurado en producción
2. **Device ID validation** - Prevenir inyecciones potenciales

### 🟠 ALTA (Implementar pronto)
3. **Rate limiting en login** - Prevenir ataques de fuerza bruta
4. **Email validation** - Validar formato de correo
5. **Projection whitelist** - Limitar proyecciones permitidas

### 🟡 MEDIA (Implementar después)
6. **Error handling mejorado** - Mensajes más específicos sin exponer internals
7. **Logging estructurado** - Mejor auditoría y debugging

---

## 🚀 Mejoras Arquitectónicas

### 1. Environment Variables Obligatorias
Crear archivo `.env.required` documentando variables obligatorias:
```
JWT_SECRET (requerido en producción)
ADMIN_PASSWORD (requerido en setup)
GENIEACS_NBI_URL (requerido)
DB_PATH (opcional, default: ./data/moca.db)
```

### 2. Health Check Extendido
Actual: Solo comprueba si el servidor responde.  
Recomendado: Validar conexión a GenieACS y BD
```javascript
app.get('/api/health', async (req, res) => {
  try {
    // Verificar BD
    getDb().prepare('SELECT 1').get();
    // Verificar GenieACS
    await nbi.get('/devices/', { params: { limit: 0 } });
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});
```

### 3. Documentación de API
Agregar OpenAPI/Swagger para documentación de endpoints.

---

## 🛠️ Cambios Recomendados NO CRÍTICOS

| Cambio | Complejidad | Beneficio | Prioridad |
|--------|-------------|----------|-----------|
| Validar JWT_SECRET | Bajo | Alto | CRÍTICA |
| Validar Device ID | Bajo | Medio | ALTA |
| Rate limiting login | Medio | Alto | ALTA |
| Email validation | Bajo | Medio | ALTA |
| Projection whitelist | Bajo | Bajo | MEDIA |
| Error handling | Medio | Medio | MEDIA |
| Logging estructurado | Alto | Medio | BAJA |
| OpenAPI/Swagger | Alto | Bajo | BAJA |

---

## ✓ Verificación Pre-Producción

- [ ] JWT_SECRET configurado con valor fuerte (mínimo 32 caracteres)
- [ ] ADMIN_PASSWORD debe ser cambiado por defecto
- [ ] Rate limiting implementado en login
- [ ] Validaciones de input en todas las rutas críticas
- [ ] Logs no exponen información sensible
- [ ] CORS configurado solo para dominios permitidos (no *)
- [ ] HTTPS forzado en producción
- [ ] Base de datos con backups automáticos
- [ ] Monitoreo y alertas en lugar

---

## 📝 Notas

- El código actual usa prepared statements correctamente (previene SQL injection)
- Bcryptjs está correctamente configurado con salt rounds: 10
- Middleware de autenticación es robusto
- Scheduler de acciones programadas es confiable y seguro
- Frontend no expone contraseñas o tokens en logs del navegador

**Revisión completada:** ✓  
**Código apto para desarrollo:** ✓  
**Apto para producción:** Pendiente de cambios críticos
