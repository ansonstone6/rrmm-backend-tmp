import { getUserFromRequest } from '../lib/supabase.js';

// Require authenticated user
export function requireAuth(handler) {
  return async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    return handler(req, res);
  };
}

// Require specific role
export function requireRole(...roles) {
  return (handler) => requireAuth(async (req, res) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    return handler(req, res);
  });
}

// Helper: only allow specific HTTP methods
export function allowMethods(...methods) {
  return (handler) => async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
    return handler(req, res);
  };
}
