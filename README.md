# Generate Release Action

Acción de GitHub para automatizar la generación y publicación de releases.

## Descripción

Esta acción permite crear releases en GitHub, adjuntar artefactos y generar changelogs de manera automática y estandarizada.

## Características

- 🏷️ Crea releases en GitHub
- 📦 Adjunta artefactos pregenerados
- 📝 Genera changelogs automáticos a partir de los commits
- 🔒 Soporte para releases draft y pre-releases
- 🚦 Permite controlar el tipo de release (mayor, menor, parche)

## Parámetros de entrada

- **tag-name**: Nombre del tag para el release (ej: `v1.2.3`). **Obligatorio**.
- **release-name**: Nombre descriptivo del release. **Obligatorio**.
- **release-notes**: Notas o changelog del release (opcional).
- **artifacts**: Ruta(s) a los artefactos a adjuntar (opcional).
- **draft**: Si el release debe crearse como borrador (`true` o `false`, por defecto: `false`).
- **prerelease**: Si el release es pre-release (`true` o `false`, por defecto: `false`).

## Ejemplo de uso

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generar Release
        uses: ./generate-release
        with:
          tag-name: 'v1.2.3'
          release-name: 'Release de Producción 1.2.3'
          release-notes: 'Cambios importantes en esta versión...'
          artifacts: './dist/app.zip'
          draft: false
          prerelease: false
```
## Post-Notas

Para realizar cambios en el repositorio, deberas generar la versión de distribución de este Nodejs.
- Para esto necesitaras instalar Nodeja par Windows o Linux en tu equipo.
- Clonar este repositorio, realizar los cambios requeridos.
- Elimianr el directoerio **dist/** para regenerar una nueva Distribución.
- Una vez realizados los cambios proceder a ejecutar los siguientes comandos:
```
    npm install --save-dev @vercel/ncc
    npm run build
```
- Se debera validar que se haya creado nuevamente el directorio **dist/**.
- Relizar el Commit y el Push al Repositorio para reflajar los cambios.
- Una vez en el GitHub, ReCrear o crear un nuevo el Release para que los cambios sean considerados.

---
DevOps Mario Fribla Gonzalez

