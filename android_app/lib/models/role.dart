/// Mirrors the role hierarchy in src/lib/auth.jsx and firestore.rules,
/// highest first: developer > superAdmin > admin > employee > guest.
///
/// `developer` holds everything superAdmin does; what makes it the top tier is
/// that groups a developer OWNS are invisible to super admins who aren't
/// members. `guest` is the bottom: invited to specific channels rather than to
/// a group. Neither is fully supported by this app yet — see docs/ROLES.md —
/// but both must parse, or a developer would show up here as an employee.
enum Role {
  guest,
  employee,
  admin,
  superAdmin,
  developer;

  static Role fromString(String? value) {
    switch (value) {
      case 'developer':
        return Role.developer;
      case 'super_admin':
        return Role.superAdmin;
      case 'admin':
        return Role.admin;
      case 'guest':
        return Role.guest;
      default:
        return Role.employee;
    }
  }

  String toFirestore() {
    switch (this) {
      case Role.developer:
        return 'developer';
      case Role.superAdmin:
        return 'super_admin';
      case Role.admin:
        return 'admin';
      case Role.employee:
        return 'employee';
      case Role.guest:
        return 'guest';
    }
  }

  String get label {
    switch (this) {
      case Role.developer:
        return 'Developer';
      case Role.superAdmin:
        return 'Super admin';
      case Role.admin:
        return 'Admin';
      case Role.employee:
        return 'Employee';
      case Role.guest:
        return 'Guest';
    }
  }

  bool get isAdmin =>
      this == Role.admin || this == Role.superAdmin || this == Role.developer;
  bool get isSuperAdmin => this == Role.superAdmin || this == Role.developer;
  bool get isGuest => this == Role.guest;
}
