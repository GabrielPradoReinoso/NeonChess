# Chuletario de Comandos — Proyecto Chess GPR

> Guarda este archivo en la raíz del repo como **COMANDOS.md** (o **COMANDOS.txt**) para tenerlo siempre a mano.

---

## 0) Abrir proyecto y preparar entorno
```powershell
# Abre la terminal integrada de VS Code y vete a la carpeta del proyecto
cd C:\WWW\Dev\chess-gpr-base-proyecto

# (Opcional) Verifica Node
node -v

# Instala/actualiza la CLI de Firebase (si hiciera falta)
npm i -g firebase-tools

# Autentícate (o reautentícate si te lo pide)
firebase login
# Si te sale el error de token caducado:
firebase login --reauth

# Asegúrate de usar el proyecto correcto
firebase use neon-chess-2dd34
# Para ver todos los proyectos configurados:
firebase use --list
```

---

## 1) Levantar el **frontend** en local

### Opción A — Emulador de Hosting (respeta rewrites/headers de `firebase.json`)  
```powershell
firebase emulators:start --only hosting
# Abre: http://localhost:5000
start http://localhost:5000
```

### Opción B — Servidor estático rápido (si no quieres emulador)
```powershell
# Una de estas dos (elige la que prefieras):
npx http-server public -p 5500 -c-1
# o
npx serve public -l 5500

start http://localhost:5500
```

---

## 2) Levantar el **backend de Socket.IO** en local (si quieres probar contra `localhost:8080`)
> Tu código ya mira `http://localhost:8080` en dev.
```powershell
# Instala dependencias (si procede)
npm install

# Arranca el server (elige lo que tengas configurado)
node server.js
# o si tu package.json tiene script:
# Asegúrate de que escucha en 8080
```

---

## 3) Desplegar al **mismo enlace** (sitio live existente)
```powershell
# Construye/actualiza tus archivos en /public (o la carpeta que uses)

# Despliegue a Hosting (live)
firebase deploy --only hosting

# (Opcional) con logs detallados
firebase deploy --only hosting --debug
```
**Resultado:** se actualiza `https://neon-chess-2dd34.web.app`.

---

## 4) Crear un **preview URL** (canal temporal) sin tocar el live
```powershell
# Crea/actualiza un canal de preview (por ejemplo “dev”)
firebase hosting:channel:deploy dev
# La CLI te mostrará una URL temporal tipo:
# https://dev--neon-chess-2dd34.web.app
```

---

## 5) Publicar en un **nuevo enlace** (nueva “site” dentro del mismo proyecto)
> Útil si quieres varias URLs bajo el mismo proyecto Firebase.
```powershell
# 1) Crea un nuevo sitio con un ID único:
firebase hosting:sites:create NUEVO_SITE_ID

# 2) Enlázalo a un “target” local para poder desplegar fácil:
firebase target:apply hosting nuevoTarget NUEVO_SITE_ID

# 3) Despliega a ese target (usando tu misma carpeta public):
firebase deploy --only hosting:nuevoTarget
```
**Resultado:** tendrás otra URL tipo `https://NUEVO_SITE_ID.web.app`.

---

## 6) Publicar en un **proyecto distinto** (nuevo proyecto = nueva URL principal)
```powershell
# (Si aún no existe el proyecto)
firebase projects:create NUEVO_PROYECTO_ID --display-name "Nombre Bonito"

# Selecciona/añade el proyecto a este repo local
firebase use --add NUEVO_PROYECTO_ID

# Inicializa hosting si es un repo nuevo (normalmente ya lo tienes)
firebase init hosting

# Despliega
firebase deploy --only hosting
```

---

## 7) Comandos útiles de mantenimiento
```powershell
# Cambiar de cuenta (si trabajas con varias)
firebase logout
firebase login

# Ver info del proyecto activo
firebase projects:list
firebase use

# Abrir la consola del proyecto en el navegador
start https://console.firebase.google.com/project/neon-chess-2dd34/overview
```

---

## 8) (Opcional) Git básico
```powershell
git status
git add .
git commit -m "Tu mensaje"
git push
```

---

## Orden típico “día siguiente”
1) Abres VS Code ➜ terminal:
```powershell
cd C:\WWW\Dev\chess-gpr-base-proyecto
firebase use neon-chess-2dd34
```
2) **Local**:
```powershell
firebase emulators:start --only hosting
# y (si quieres sockets locales)
node server.js
```
3) **Probar en navegador**:
```powershell
start http://localhost:5000
```
4) **Subir cambios al live**:
```powershell
firebase deploy --only hosting
```
