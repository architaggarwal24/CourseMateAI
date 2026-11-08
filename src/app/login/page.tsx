"use client";

import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Brain, Eye, EyeOff, Layers, MessageSquare, Sparkles, Swords, Trophy, Zap } from '@/components/icons';
import { Magnetic, TextReveal } from '@/components/fx';
import './login.css';
import SignupFlow from '@/components/auth/SignupFlow';
import GoogleButton from '@/components/auth/GoogleButton';
import ResetPassword from '@/components/auth/ResetPassword';
import TwoFactorStep from '@/components/auth/TwoFactorStep';
import VerifyEmailStep from '@/components/auth/VerifyEmailStep';
import { Button, Card, Input } from '@/components/ui';
import { fetchAuthConfig } from '@/lib/auth/config';
import { ROUTES } from '@/lib/routes';
import { safeNext } from '@/lib/auth/session-cookie';
import Logo from '@/components/brand/Logo';

/** What the card shows: the log-in form, or one of the steps that can follow it. */
type Mode = 'login' | 'register' | 'two-factor' | 'verify' | 'forgot';

export default function LoginPage() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [google, setGoogle] = useState(false);
  const isRegister = mode === 'register';

  const { login, refresh, user, loading: authLoading } = useAuth();
  const router = useRouter();
  // ?next= (an app page that sent you here) and ?mode=register (the landing page's "Start free")
  const [next, setNext] = useState<string>(ROUTES.today);

  useEffect(() => {
    let alive = true;
    fetchAuthConfig().then((c) => { if (alive) setGoogle(c.google); });
    const q = new URLSearchParams(window.location.search);
    if (q.get('error') === 'google') setError("Google sign-in didn't finish. Please try again.");
    if (q.get('mode') === 'register') setMode('register');
    setNext(safeNext(q.get('next'), ROUTES.today));
    return () => { alive = false; };
  }, []);

  // Already signed in (a bookmark, the back button): on to the app.
  useEffect(() => {
    if (!authLoading && user && mode === 'login') router.replace(safeNext(new URLSearchParams(window.location.search).get('next'), ROUTES.today));
  }, [authLoading, user, mode, router]);

  async function signedIn() {
    await refresh();
    router.push(next);
  }

  const handleChange = (e: React.FormEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setNotice('');
    try {
      const result = await login(formData.email, formData.password);
      if (result.status === 'signed-in') router.push(next);
      else if (result.status === 'two-factor') setMode('two-factor');
      else if (result.status === 'verify-email') setMode('verify');
      else setError(result.failure.message);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const toggleMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError('');
    setNotice('');
    setFormData({ email: '', password: '' });
  };
  const backToLogin = () => { setMode('login'); setError(''); };

  return (
    <main id="main-content" tabIndex={-1} className="login outline-none">

      {/* Left: what CourseMateAI is, shown rather than told (wide screens only) */}
      <section className="login__showcase" aria-label="About CourseMateAI">
        <div className="login__brand"><Link href={ROUTES.home} aria-label="CourseMateAI home" className="inline-flex"><Logo size={30} /></Link></div>

        <div className="login__pitch">
          <p className="login__eyebrow fx-rise">
            <Zap size={13} aria-hidden="true" /> Your AI study companion
          </p>
          <TextReveal as="h2" className="login__headline text-gradient" text="Study smarter. Level up while you do." />
          <p className="login__lede fx-rise" style={{ "--fx-delay": "500ms", "--fx-dur": "800ms", "--fx-y": "0px" } as CSSProperties}>
            Upload a PDF. Chat with it, turn it into quizzes, flashcards and notes — then take what you learned into the arena.
          </p>
          <ul className="login__features">
            {[
              { icon: <MessageSquare size={16} />, text: "Answers grounded in your document, with sources" },
              { icon: <Brain size={16} />, text: "Quizzes and flashcards in one click" },
              { icon: <Swords size={16} />, text: "Boss battles built from what you got wrong" },
            ].map((f, i) => (
              <li key={f.text} className="fx-rise" style={{ "--fx-delay": `${700 + i * 100}ms`, "--fx-dur": "500ms", "--fx-x": "-10px", "--fx-y": "0px" } as CSSProperties}>
                <span className="login__feature-icon" aria-hidden="true">{f.icon}</span>{f.text}
              </li>
            ))}
          </ul>
        </div>

        {/* floating previews of the product */}
        <div className="login__previews" aria-hidden="true">
          <div className="login__preview login__preview--chat">
            <span className="login__bubble login__bubble--you">What does the mitochondrion do?</span>
            <span className="login__bubble login__bubble--ai"><Sparkles size={12} /> It makes most of the cell&apos;s ATP…</span>
          </div>
          <div className="login__preview login__preview--quiz">
            <span className="login__preview-label"><Layers size={12} /> Quiz · 3 of 5</span>
            <span className="login__opt login__opt--ok">Mitochondria</span>
            <span className="login__opt">Golgi apparatus</span>
          </div>
          <div className="login__preview login__preview--xp">
            <Trophy size={16} /> <strong>+45 XP</strong> <span>Level 7</span>
          </div>
        </div>
      </section>

      {/* Right: the form */}
      <section className="login__panel">
        <div className="login__card fx-rise" style={{ "--fx-y": "18px" } as CSSProperties}>
          <div className="login__card-head">
            <h1 className="login__title"><Logo size={24} /></h1>
          </div>
          <h2 className="login__welcome">{isRegister ? 'Create your account' : 'Welcome back'}</h2>
          <p className="login__sub">{isRegister ? 'A few details and you are in.' : 'Log in to pick up where you left off.'}</p>

          {(mode === 'login' || mode === 'register') && google && (
            <div className="space-y-4 mb-4">
              <GoogleButton onError={setError} />
              <p className="login__or text-center text-xs text-fg-muted" aria-hidden="true">or with your email</p>
            </div>
          )}

          {mode === 'register' ? (
            <SignupFlow onDone={() => router.push(next)} />
          ) : mode === 'two-factor' ? (
            <TwoFactorStep onDone={signedIn} onCancel={backToLogin} />
          ) : mode === 'verify' ? (
            <VerifyEmailStep email={formData.email} sent={false} onVerified={signedIn} />
          ) : mode === 'forgot' ? (
            <ResetPassword initialEmail={formData.email}
              onDone={(email) => { setMode('login'); setFormData({ email, password: '' }); setNotice('Password changed. Log in with the new one.'); }}
              onCancel={backToLogin} />
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <Input label="Email" type="email" name="email" value={formData.email} onChange={handleChange}
                placeholder="you@example.com" required />

              <Input label="Password" type={showPassword ? "text" : "password"} name="password" value={formData.password}
                onChange={handleChange} placeholder="••••••••" required minLength={8}
                trailing={
                  <Button variant="ghost" size="sm" icon onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </Button>
                } />

              <div className="text-right -mt-2">
                <Button variant="ghost" size="sm" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</Button>
              </div>

              {notice && <Card tone="success" pad="sm" role="status"><p className="text-sm">{notice}</p></Card>}
              {error && (
                <Card tone="danger" pad="sm" role="alert">
                  <p className="text-sm text-ink-red">{error}</p>
                </Card>
              )}

              <Magnetic className="block w-full" strength={0.12}>
                <Button type="submit" variant="primary" size="lg" block loading={loading}>
                  {loading ? 'Logging in…' : 'Log in'}
                </Button>
              </Magnetic>
            </form>
          )}

          {mode !== 'login' && mode !== 'register' && error && (
            <Card tone="danger" pad="sm" role="alert" className="mt-4"><p className="text-sm text-ink-red">{error}</p></Card>
          )}

          {(mode === 'login' || mode === 'register') && <div className="mt-6 text-center">
            <Button variant="ghost" size="sm" onClick={toggleMode}>
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <span className="font-semibold text-ink-blue">{isRegister ? 'Log in' : 'Sign up'}</span>
            </Button>
          </div>}
        </div>

        <p className="text-center text-xs text-fg-muted mt-6">
          By continuing, you agree to our <a className="underline" href="/legal/terms">Terms of Service</a> and{" "}
          <a className="underline" href="/legal/privacy">Privacy Policy</a>. <a className="underline" href="/legal/refunds">Refunds</a>
        </p>
      </section>
    </main>
  );
}
