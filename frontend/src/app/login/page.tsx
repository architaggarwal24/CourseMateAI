"use client";

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Brain, Eye, EyeOff, Layers, MessageSquare, Sparkles, Swords, Trophy, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { Aurora, Magnetic, TextReveal, TiltCard } from '@/components/fx';
import './login.css';
import SignupFlow from '@/components/auth/SignupFlow';
import { Button, Card, Input } from '@/components/ui';
import { ROUTES } from '@/lib/routes';

export default function LoginPage() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { login } = useAuth();
  const router = useRouter();

  const handleChange = (e: React.FormEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const success = await login(formData.email, formData.password);
      if (success === true) router.push(ROUTES.study);
      else setError('Invalid credentials');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const toggleMode = () => {
    setIsRegister(!isRegister);
    setError('');
    setFormData({ email: '', password: '' });
  };

  return (
    <main id="main-content" tabIndex={-1} className="login outline-none">
      <div className="login__backdrop" aria-hidden="true"><Aurora /></div>

      {/* Left: what CourseMateAI is, shown rather than told (wide screens only) */}
      <section className="login__showcase" aria-label="About CourseMateAI">
        <div className="login__brand">
          <span className="login__logo" aria-hidden="true"><Sparkles size={20} /></span>
          <span className="login__brandname">CourseMateAI</span>
        </div>

        <div className="login__pitch">
          <motion.p className="login__eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Zap size={13} aria-hidden="true" /> Your AI study companion
          </motion.p>
          <TextReveal as="h2" className="login__headline text-gradient" text="Study smarter. Level up while you do." />
          <motion.p className="login__lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }}>
            Upload a PDF. Chat with it, turn it into quizzes, flashcards and notes — then take what you learned into the arena.
          </motion.p>
          <ul className="login__features">
            {[
              { icon: <MessageSquare size={16} />, text: "Answers grounded in your document, with sources" },
              { icon: <Brain size={16} />, text: "Quizzes and flashcards in one click" },
              { icon: <Swords size={16} />, text: "Boss battles built from what you got wrong" },
            ].map((f, i) => (
              <motion.li key={f.text} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.1, duration: 0.5 }}>
                <span className="login__feature-icon" aria-hidden="true">{f.icon}</span>{f.text}
              </motion.li>
            ))}
          </ul>
        </div>

        {/* floating previews of the product */}
        <div className="login__previews" aria-hidden="true">
          <TiltCard className="login__preview login__preview--chat" max={10}>
            <span className="login__bubble login__bubble--you">What does the mitochondrion do?</span>
            <span className="login__bubble login__bubble--ai"><Sparkles size={12} /> It makes most of the cell&apos;s ATP…</span>
          </TiltCard>
          <TiltCard className="login__preview login__preview--quiz" max={10}>
            <span className="login__preview-label"><Layers size={12} /> Quiz · 3 of 5</span>
            <span className="login__opt login__opt--ok">Mitochondria</span>
            <span className="login__opt">Golgi apparatus</span>
          </TiltCard>
          <TiltCard className="login__preview login__preview--xp" max={12}>
            <Trophy size={16} /> <strong>+45 XP</strong> <span>Level 7</span>
          </TiltCard>
        </div>
      </section>

      {/* Right: the form */}
      <section className="login__panel">
        <motion.div className="login__card" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          <div className="login__card-head">
            <span className="login__logo login__logo--sm" aria-hidden="true"><Sparkles size={16} /></span>
            <h1 className="login__title">CourseMateAI</h1>
          </div>
          <h2 className="login__welcome">{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="login__sub">{isRegister ? 'A few details and you are in.' : 'Log in to pick up where you left off.'}</p>

          {isRegister ? (
            <SignupFlow onDone={() => router.push(ROUTES.study)} />
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

              {error && (
                <Card tone="danger" pad="sm" role="alert">
                  <p className="text-sm text-ink-red">{error}</p>
                </Card>
              )}

              <Magnetic className="block w-full" strength={0.12}>
                <Button type="submit" variant="primary" size="lg" block loading={loading}>
                  {loading ? 'Please wait...' : 'Login'}
                </Button>
              </Magnetic>
            </form>
          )}

          <div className="mt-6 text-center">
            <Button variant="ghost" size="sm" onClick={toggleMode}>
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <span className="font-semibold text-ink-blue">{isRegister ? 'Login' : 'Register'}</span>
            </Button>
          </div>
        </motion.div>

        <p className="text-center text-xs text-fg-muted mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </section>
    </main>
  );
}
