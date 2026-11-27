# Mi presupuesto

Aplicación web instalable para planificar gastos mensuales en quetzales, registrar ingresos y gastos, y comparar el consumo con el plan.

## Probar la nueva versión

Desde la raíz del proyecto, ejecuta `python -m http.server 8000` y abre [localhost:8000](http://localhost:8000). Con `supabase-config.js` vacío, la aplicación guarda los datos en el navegador. Ese modo conserva el formato de almacenamiento de la versión anterior cuando ambos se abren bajo el mismo origen.

## Conectar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard). En **SQL Editor**, abre una consulta, pega el contenido de [`001_budget_workspaces.sql`](supabase/migrations/001_budget_workspaces.sql) y pulsa **Run**. La tabla guarda un registro por cuenta. Las políticas RLS limitan la lectura y la escritura al propietario.
2. En **Authentication → Users**, crea tu usuario con correo y contraseña desde **Add user → Create new user** y confirma su correo al crearlo si aparece la opción. Para un presupuesto de uso personal puedes desactivar el registro público en la configuración de autenticación y administrar las cuentas desde ese panel. La app incluye inicio de sesión por correo y contraseña.
3. Abre **Connect** en el panel del proyecto, copia **Project URL** y **Publishable key** y colócalas en [`supabase-config.js`](supabase-config.js).

   ```javascript
   window.budgetSupabaseConfig = {
       url: 'https://TU-PROYECTO.supabase.co',
       publishableKey: 'sb_publishable_...',
   };
   ```

   La clave publicable está diseñada para el frontend. Conserva las claves `sb_secret_...`, `service_role` y la contraseña de Postgres en Supabase.
4. Abre la aplicación, inicia sesión y registra un movimiento de prueba. Cuando el estado indique **Presupuesto sincronizado**, abre la app en otro navegador e inicia sesión con la misma cuenta para comprobar el movimiento.
5. En la aplicación anterior, abre **Planear → Respaldar Datos**. Tras verificar la conexión de la nueva versión, inicia sesión y abre **Plan → Importar Datos**. El archivo reemplaza el presupuesto actual previa confirmación. Descarga un respaldo antes si quieres conservar los datos de prueba o cualquier cambio de la cuenta.

La versión con Supabase requiere conexión para iniciar sesión y cargar el presupuesto. Tras cargarlo, los cambios se guardan automáticamente. Si falla la conexión durante una edición, la pestaña conserva los cambios pendientes y muestra **Reintentar**. Si ya se guardó otra versión desde otro dispositivo, descarga un respaldo antes de cargar la versión de la nube. Cada cuenta usa una instantánea JSON de todos los meses, con una revisión para evitar que una edición antigua sobrescriba cambios de otro dispositivo.

Puedes servir estos archivos desde GitHub Pages. Para probar la rama en tu equipo, sirve la copia de esa rama con el comando de arriba.
