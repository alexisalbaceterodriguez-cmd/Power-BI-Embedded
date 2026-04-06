'use client';

import { useEffect, useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'Acceso denegado. Tu cuenta no esta autorizada para acceder a esta plataforma.',
  Configuration: 'Se detecto un problema de configuracion del inicio de sesion. Intentalo de nuevo en unos minutos.',
  Verification: 'No se pudo verificar tu inicio de sesion. Vuelve a intentarlo.',
  OAuthSignin: 'No se pudo iniciar la autenticacion con Microsoft. Intenta nuevamente.',
  OAuthCallback: 'La respuesta de autenticacion no fue valida. Intenta iniciar sesion otra vez.',
  Callback: 'No se pudo completar el proceso de inicio de sesion. Intenta nuevamente.',
  SessionRequired: 'Tu sesion no es valida o ha expirado. Inicia sesion de nuevo.',
};

function getAuthErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return AUTH_ERROR_MESSAGES[errorCode] ?? 'Se produjo un error durante el inicio de sesion. Intentalo nuevamente.';
}

function LoginContent() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const urlErrorMessage = getAuthErrorMessage(urlError);

  const [error, setError] = useState<string | null>(urlErrorMessage);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [showRecoveryActions, setShowRecoveryActions] = useState(Boolean(urlError));

  useEffect(() => {
    setError(urlErrorMessage);
    setShowRecoveryActions(Boolean(urlError));
  }, [urlErrorMessage, urlError]);

  async function handleMicrosoftLogin() {
    setError(null);
    setMicrosoftLoading(true);
    await signIn(
      'microsoft-entra-id',
      { callbackUrl: '/' },
      { prompt: 'select_account' }
    );
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
        {urlError && showRecoveryActions ? (
          <div style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className="login-btn"
              onClick={handleMicrosoftLogin}
              disabled={microsoftLoading}
              style={{ marginTop: 0 }}
            >
              Probar con otra cuenta
            </button>
          </div>
        ) : null}

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
          disabled={microsoftLoading}
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
