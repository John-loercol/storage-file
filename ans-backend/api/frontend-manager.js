const permissions = require('../database/permissions-manager');
const sessions = require('../database/sessions-manager');

function registerFrontendRoutes(app) {
    app.get('/api/tasks', async (req, res) => {
        try {
            const supabase = permissions.supabase;
            if (!supabase) {
                return res.status(500).json({ error: 'Database connection is not available' });
            }

            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .order('due_date', { ascending: true });

            if (error) throw error;
            res.json({ success: true, data });
        } catch (err) {
            console.error('Error fetching tasks API:', err);
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    });

    app.get('/api/me', async (req, res) => {
        try {
            const result = await sessions.getSession(req);
            if (!result) {
                return res.status(401).json({ authenticated: false });
            }

            res.json({
                authenticated: true,
                user: result.user,
                session: {
                    created_at: result.session.created_at,
                    last_seen_at: result.session.last_seen_at,
                    expires_at: result.session.expires_at
                }
            });
        } catch (error) {
            console.error('Session check error:', error);
            res.status(500).json({
                authenticated: false,
                error: 'Internal Server Error'
            });
        }
    });

    app.post('/auth/logout', async (req, res) => {
        try {
            await sessions.destroySession(req);
            sessions.clearSessionCookie(res);
            res.json({ success: true });
        } catch (error) {
            console.error('Logout error:', error);
            sessions.clearSessionCookie(res);
            res.status(500).json({ success: false });
        }
    });
}

module.exports = { registerFrontendRoutes };
