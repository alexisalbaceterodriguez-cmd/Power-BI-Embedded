'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Credenciales incorrectas. Por favor, verifica tu usuario o contraseña.');
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <div className="login-page">
      {/* Left Banner: Corporate Identity */}
      <div className="login-visual">
        <div className="login-visual-content">
          <h1 className="login-visual-title">
            Transformation<br />
            <span>&amp; Technology</span>
          </h1>
          <p className="login-visual-desc">
            Te acompañamos en tu transformación digital. 
            Accede a tu portal corporativo para explorar tus cuadros de mando interactivos e impulsar la innovación basada en datos.
          </p>
        </div>
      </div>

      {/* Right Banner: Login Area */}
      <div className="login-form-container">
        <div className="login-card">
          <div className="login-brand-mobile">
            Seidor <span>T&amp;T</span>
          </div>

          <div className="login-form-header">
            <h2 className="login-title">Inicia Sesión</h2>
            <p className="login-subtitle">Introduce tus credenciales corporativas para acceder a la plataforma.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className="form-group">
              <label htmlFor="username" className="form-label">Usuario</label>
              <input
                id="username"
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ej: nombre.apellido"
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">Contraseña</label>
              <input
                id="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="login-error" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-btn"
              disabled={loading}
              id="login-submit"
            >
              {loading ? (
                <span className="btn-spinner" aria-label="Validando credenciales..." />
              ) : (
                'Acceder al Portal'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
