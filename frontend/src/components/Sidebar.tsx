import { Home, Users, Calendar, DollarSign, Settings, ChevronLeft, ChevronRight, Shield, UserCircle } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "./Languagecontext"; // adjust path if needed
import { useAuth } from "../contexts/AuthContext";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { isAdmin, canView } = useAuth();

  const navItems = [
    { key: "nav_dashboard" as const, icon: Home,       path: "/dashboard",  page: "dashboard" },
    { key: "nav_patients"  as const, icon: Users,      path: "/patients",   page: "patients" },
    { key: "nav_calendar"  as const, icon: Calendar,   path: "/calendar",   page: "calendar" },
    { key: "nav_financials"as const, icon: DollarSign, path: "/financials", page: "financials" },
  ].filter((item) => canView(item.page));

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && <h2>{t("app_name")}</h2>}
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? t("side_expand") : t("side_collapse")}
          aria-label={collapsed ? t("side_expand") : t("side_collapse")}
        >
          {collapsed
            ? <ChevronRight className="toggle-icon" size={20} />
            : <ChevronLeft className="toggle-icon" size={20} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          // Prefix match so /patient/:id highlights the Patients item
          // (detail route is singular "patient", nav is plural "patients").
          const isActive = location.pathname === item.path
            || location.pathname.startsWith(item.path + "/")
            || (item.path === "/patients" && location.pathname.startsWith("/patient/"));
          return (
            <button
              key={item.path}
              className={`nav-button ${isActive ? "active" : ""}`}
              onClick={() => navigate(item.path)}
              title={collapsed ? t(item.key) : undefined}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{t(item.key)}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {isAdmin && canView("admin") && (
          <button
            className={`nav-button ${location.pathname.startsWith("/admin") ? "active" : ""}`}
            onClick={() => navigate("/admin")}
            title={collapsed ? t("nav_admin_users") : undefined}
          >
            <Shield className="nav-icon" size={20} />
            <span>{t("nav_admin_users")}</span>
          </button>
        )}
        <button
          className={`nav-button ${location.pathname === "/profile" ? "active" : ""}`}
          onClick={() => navigate("/profile")}
          title={collapsed ? t("nav_profile") : undefined}
        >
          <UserCircle className="nav-icon" size={20} />
          <span>{t("nav_profile")}</span>
        </button>
        {canView("settings") && (
          <button
            className={`nav-button ${location.pathname === "/settings" ? "active" : ""}`}
            onClick={() => navigate("/settings")}
            title={collapsed ? t("nav_settings") : undefined}
          >
            <Settings className="nav-icon" size={20} />
            <span>{t("nav_settings")}</span>
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
