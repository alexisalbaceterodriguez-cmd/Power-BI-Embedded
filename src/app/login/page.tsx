'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    urlError === 'AccessDenied' 
      ? 'Acceso denegado. Tu cuenta no está autorizada para acceder a esta plataforma.' 
      : null
  );
  const [loading, setLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  async function handleMicrosoftLogin() {
    setError(null);
    setMicrosoftLoading(true);
    await signIn('microsoft-entra-id', { callbackUrl: '/' });
  }

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
    <div className="login-form-container">
      <div className="login-card">
        <div className="login-brand-mobile">
          <Image src="/LOGO_COLOR_POSITIVE.webp" alt="Seidor Logo" width={140} height={40} style={{ objectFit: 'contain' }} priority />
        </div>

        <div className="login-form-header">
          <h2 className="login-title">Inicia Sesión</h2>
          <p className="login-subtitle">Introduce tus credenciales corporativas para acceder a la plataforma.</p>
        </div>

        {error && (
          <div className="login-error" role="alert" style={{ marginBottom: '1rem' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true" style={{ marginRight: '8px' }}>
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        {/* Microsoft Sign-In Button */}
        <button
          type="button"
          className="login-btn"
          style={{
            backgroundColor: '#000000',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '1.5rem',
            border: '1px solid #333'
          }}
          onClick={handleMicrosoftLogin}
          disabled={microsoftLoading || loading}
        >
          {microsoftLoading ? (
            <span className="btn-spinner" aria-label="Redirigiendo..." />
          ) : (
             <>
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 21 21"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>
               Iniciar sesión con Microsoft
             </>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', textAlign: 'center', margin: '1rem 0', color: '#666', fontSize: '0.875rem' }}>
          <div style={{ flex: 1, borderBottom: '1px solid #eaeaea' }}></div>
          <span style={{ padding: '0 10px' }}>O con credenciales locales</span>
          <div style={{ flex: 1, borderBottom: '1px solid #eaeaea' }}></div>
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
              disabled={loading || microsoftLoading}
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
              disabled={loading || microsoftLoading}
            />
          </div>

          <button
            type="submit"
            className="login-btn"
            disabled={loading || microsoftLoading}
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
  );
}

export default function LoginPage() {
  return (
    <div className="login-page">
      {/* Left Banner: Corporate Identity */}
      <div className="login-visual">
        <div className="login-visual-content">
          <div className="login-logo">
            <Image src="/LOGO_COLOR_POSITIVE.webp" alt="Seidor Logo" width={180} height={50} style={{ objectFit: 'contain' }} priority />
          </div>
          <h1 className="login-visual-title">
            Human focused.<br />
            <strong>Technology Experts.</strong>
          </h1>
          <p className="login-visual-desc">
            Transformation &amp; Technology. Accede a tu portal corporativo para explorar tus cuadros de mando interactivos e impulsar la innovación basada en datos.
          </p>
        </div>
      </div>

      {/* Right Banner: Login Area */}
      <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100%' }}>Cargando...</div>}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
