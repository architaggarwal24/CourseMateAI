"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  Lock,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import ProfileHero from "@/components/account/ProfileHero";

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    fullName: "",
    username: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [loading, setLoading] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(ROUTES.login);
    }
  }, [user, authLoading, router]);

  // Load user data
  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        fullName: user.full_name || "",
        username: user.username || "",
        email: user.email || "",
      }));
    }
  }, [user]);

  // Check username availability (debounced)
  useEffect(() => {
    if (!formData.username || formData.username === user?.username) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const { data } = await rawApi.GET("/auth/check-username", {
          params: { query: { username: formData.username } },
        });
        setUsernameAvailable(data?.available ?? null);
      } catch (error) {
        console.error("Username check failed:", error);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.username, user?.username]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (formData.username && formData.username.length < 3) {
      toast.error("Username must be at least 3 characters");
      return;
    }

    if (formData.username && formData.username !== user?.username && !usernameAvailable) {
      toast.error("Username is not available");
      return;
    }

    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (formData.newPassword && formData.newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const updateData: any = {};

      if (formData.fullName !== user?.full_name) {
        updateData.full_name = formData.fullName;
      }

      if (formData.username !== user?.username) {
        updateData.username = formData.username;
      }

      if (formData.email !== user?.email) {
        updateData.email = formData.email;
      }

      if (formData.newPassword) {
        updateData.current_password = formData.currentPassword;
        updateData.new_password = formData.newPassword;
      }

      const { error, response } = await rawApi.POST("/auth/update-profile", { body: updateData });

      if (response.ok) {
        toast.success("Profile updated successfully!", { icon: "✅" });

        // Clear password fields
        setFormData(prev => ({
          ...prev,
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        }));

        // Refresh page to get updated user data
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        toast.apiError(parseApiError(response.status, error));
      }
    } catch (error) {
      toast.apiError(error, { fallbackMessage: "Couldn't reach the server, so nothing was saved. Check your connection and try again." });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center">
        <Loader2 size={32} className="ui-spinner text-ink-gold" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div>
      <div className="max-w-4xl mx-auto px-6 pt-6">
        <h1 className="sr-only">Profile</h1>
        <ProfileHero name={user.full_name || user.username || user.email} handle={user.username || undefined} />
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card title="Personal Information" headingLevel={2}>
            <Input label="Full Name" type="text" name="fullName" value={formData.fullName} onChange={handleChange}
              leading={<User size={18} />} placeholder="John Doe" />

            <Input label="Username" type="text" name="username" value={formData.username} onChange={handleChange}
              leading={<User size={18} />} placeholder="johndoe" minLength={3}
              error={usernameAvailable === false ? "Username is already taken" : undefined}
              hint={usernameAvailable === true ? <span className="text-ink-green">Username is available</span> : undefined}
              trailing={
                checkingUsername ? <Loader2 size={16} className="ui-spinner" aria-label="Checking username" />
                : usernameAvailable === true ? <CheckCircle2 size={16} className="text-ink-green" aria-hidden="true" />
                : usernameAvailable === false ? <XCircle size={16} className="text-ink-red" aria-hidden="true" />
                : undefined
              } />

            <Input label="Email" type="email" name="email" value={formData.email} onChange={handleChange}
              leading={<Mail size={18} />} placeholder="john@example.com" />
          </Card>

          <Card title="Change Password" headingLevel={2}>
            <Input label="Current Password" type={showCurrentPassword ? "text" : "password"} name="currentPassword"
              value={formData.currentPassword} onChange={handleChange} leading={<Lock size={18} />} placeholder="••••••••"
              trailing={
                <Button variant="ghost" size="sm" icon onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}>
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              } />

            <Input label="New Password" hint="At least 8 characters" type={showNewPassword ? "text" : "password"}
              name="newPassword" value={formData.newPassword} onChange={handleChange} leading={<Lock size={18} />}
              placeholder="••••••••" minLength={8}
              trailing={
                <Button variant="ghost" size="sm" icon onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? "Hide new password" : "Show new password"}>
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              } />

            <Input label="Confirm New Password" type={showConfirmPassword ? "text" : "password"} name="confirmPassword"
              value={formData.confirmPassword} onChange={handleChange} leading={<Lock size={18} />}
              placeholder="••••••••" minLength={8}
              trailing={
                <Button variant="ghost" size="sm" icon onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}>
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              } />
          </Card>

          {/* Submit Button */}
          <div className="flex items-center gap-4">
            <Button type="submit" variant="primary" className="flex-1" loading={loading}
              disabled={usernameAvailable === false}>
              {loading ? "Saving..." : <><Save size={18} />Save Changes</>}
            </Button>
            <Button onClick={() => router.push(ROUTES.study)}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
