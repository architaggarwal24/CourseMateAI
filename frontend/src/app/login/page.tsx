"use client";

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Sparkles, Key, CheckCircle2, Loader2, ExternalLink, Info } from 'lucide-react';

const PROVIDERS = [
  {
    id: "mistral",
    label: "Mistral AI",
    color: "from-orange-500 to-orange-700",
    docsUrl: "https://console.mistral.ai/api-keys",
    placeholder: "sk-...",
    hint: "Free tier available — get key at console.mistral.ai",
    recommended: true,
    infoTooltip: null,
    models: [
      { id: "mistral-large-2512", label: "Mistral Large" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    color: "from-blue-500 to-blue-700",
    docsUrl: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza...",
    hint: "Free tier available — get key at aistudio.google.com",
    recommended: false,
    infoTooltip: "Free but limited quota",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    color: "from-green-500 to-green-700",
    docsUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
    hint: "Requires billing — get key at platform.openai.com",
    recommended: false,
    infoTooltip: null,
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    color: "from-purple-500 to-purple-700",
    docsUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
    hint: "Requires billing — get key at console.anthropic.com",
    recommended: false,
    infoTooltip: null,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ],
  },
];

export default function LoginPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    apiKey: '',
  });
  const [provider, setProvider] = useState('mistral');
  const [model, setModel] = useState('mistral-large-2512');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const { login, register } = useAuth();
  const router = useRouter();

  const selectedProvider = PROVIDERS.find(p => p.id === provider)!;

  const handleChange = (e: React.FormEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleProviderChange = (pid: string) => {
    setProvider(pid);
    const p = PROVIDERS.find(x => x.id === pid)!;
    setModel(p.models[0].id);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (isRegister) {
      if (!formData.fullName.trim()) { setError('Full name is required'); return; }
      if (!formData.username.trim()) { setError('Username is required'); return; }
      if (formData.username.length < 3) { setError('Username must be at least 3 characters'); return; }
      if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return; }
      if (formData.password.length < 8) { setError('Password must be at least 8 characters'); return; }
      if (!formData.apiKey.trim()) { setError('API key is required'); return; }
    }

    setLoading(true);

    const success = isRegister
      ? await register(formData.email, formData.password, formData.username, formData.fullName, formData.apiKey.trim(), provider, model)
      : await login(formData.email, formData.password);

    if (success === true) {
      router.push('/');
    } else {
      setError(isRegister
        ? (typeof success === 'string' ? success : 'Registration failed. The API key may be invalid, or the email/username is already taken.')
        : 'Invalid credentials');
    }

    setLoading(false);
  }

  const toggleMode = () => {
    setIsRegister(!isRegister);
    setError('');
    setFormData({ fullName: '', username: '', email: '', password: '', confirmPassword: '', apiKey: '' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="p-3 rounded-xl bg-accent-gold/10 border border-accent-gold/20">
              <Sparkles size={28} className="text-accent-gold" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-accent-gold to-accent-purple bg-clip-text text-transparent">
            CourseMateAI
          </h1>
          <p className="text-text-muted text-sm">Your AI-powered study companion</p>
        </div>

        {/* Form Card */}
        <div className="p-8 bg-bg-card rounded-xl border border-border shadow-2xl">
          <h2 className="text-2xl font-bold mb-6 text-center text-text-primary">
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">Full Name</label>
                  <input type="text" name="fullName" value={formData.fullName} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                    placeholder="John Doe" required />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">Username</label>
                  <input type="text" name="username" value={formData.username} onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                    placeholder="johndoe" required minLength={3} />
                  <p className="text-xs text-text-muted mt-1">At least 3 characters, no spaces</p>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Email</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange}
                className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                placeholder="you@example.com" required />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange}
                  className="w-full px-4 py-2.5 pr-10 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                  placeholder="••••••••" required minLength={8} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {isRegister && <p className="text-xs text-text-muted mt-1">At least 8 characters</p>}
            </div>

            {isRegister && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <input type={showConfirmPassword ? "text" : "password"} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange}
                      className="w-full px-4 py-2.5 pr-10 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                      placeholder="••••••••" required minLength={8} />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* ── AI Provider + Key ─────────────────────────────── */}
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <Key size={15} className="text-accent-gold" />
                    <span className="text-sm font-semibold text-text-primary">AI Provider</span>
                    <span className="text-xs text-text-muted ml-auto">Your key — your usage</span>
                  </div>

                  {/* Provider selector */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {PROVIDERS.map(p => (
                      <button key={p.id} type="button" onClick={() => handleProviderChange(p.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                          provider === p.id
                            ? `bg-gradient-to-r ${p.color} border-transparent text-white`
                            : 'border-border text-text-muted hover:border-accent-gold/40 hover:text-text-primary bg-bg-primary'
                        }`}>
                        {provider === p.id && <CheckCircle2 size={12} />}
                        <span>{p.label}</span>
                        {/* Recommended badge */}
                        {p.recommended && (
                          <span className="ml-auto text-[9px] bg-accent-gold/20 text-accent-gold px-1 py-0.5 rounded font-semibold">
                            RECOMMENDED
                          </span>
                        )}
                        {/* Gemini info icon */}
                        {p.infoTooltip && !p.recommended && (
                          <span className="ml-auto relative group">
                            <Info size={11} className="text-blue-400 cursor-help" />
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-36 text-center text-[10px] bg-bg-card border border-border text-text-muted px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                              {p.infoTooltip}
                            </span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Model selector — only shown if provider has multiple models */}
                  {selectedProvider.models.length > 1 && (
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-text-muted mb-1.5">Model</label>
                      <select value={model} onChange={e => setModel(e.target.value)}
                        className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent-gold transition-all">
                        {selectedProvider.models.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* API key input */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-text-muted">{selectedProvider.label} API Key</label>
                      <a href={selectedProvider.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-accent-gold hover:underline flex items-center gap-1">
                        Get key <ExternalLink size={11} />
                      </a>
                    </div>
                    <input type="password" name="apiKey" value={formData.apiKey} onChange={handleChange}
                      className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all font-mono text-sm"
                      placeholder={selectedProvider.placeholder} required />
                    <p className="text-xs text-text-muted mt-1">🔒 Encrypted at rest — {selectedProvider.hint}</p>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="p-3 bg-accent-red/10 border border-accent-red/30 rounded-lg">
                <p className="text-accent-red text-sm">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-accent-gold to-accent-purple text-black font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent-gold/20 flex items-center justify-center gap-2">
              {loading ? <><Loader2 size={18} className="animate-spin" /> {isRegister ? 'Validating key...' : 'Please wait...'}</> : (isRegister ? 'Create Account' : 'Login')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button onClick={toggleMode} className="text-sm text-text-muted hover:text-accent-gold transition-colors">
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <span className="font-semibold">{isRegister ? 'Login' : 'Register'}</span>
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}