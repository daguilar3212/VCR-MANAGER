import { useAuth } from './AuthProvider.jsx';
import LoginPage from './LoginPage.jsx';
import App from './App.jsx';

export default function AppGuard() {
  const { session, profile, loading, signOut } = useAuth();

  // 1. Mientras carga el estado de auth
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f4f4f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#71717a',
      }}>
        Cargando...
      </div>
    );
  }

  // 2. Si no hay sesión, mostrar login
  if (!session) {
    return <LoginPage />;
  }

  // 3. Si hay sesión pero no hay perfil en la tabla profiles
  if (!profile) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f4f4f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <h2 style={{ color: '#991b1b', marginBottom: '1rem' }}>
          Cuenta sin configurar
        </h2>
        <p style={{ color: '#71717a', maxWidth: '400px', marginBottom: '1.5rem' }}>
          Tu usuario existe pero no tiene un perfil asignado. Contacta al administrador para activar tu cuenta.
        </p>
        <button
          onClick={signOut}
          style={{
            padding: '0.6rem 1.5rem',
            background: '#18181b',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  // 4. Hay sesión y perfil válido: mostrar la app
  return <App />;
}
