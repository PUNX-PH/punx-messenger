enum Role {
  employee,
  admin,
  superAdmin;

  static Role fromString(String? value) {
    switch (value) {
      case 'super_admin':
        return Role.superAdmin;
      case 'admin':
        return Role.admin;
      default:
        return Role.employee;
    }
  }

  String toFirestore() {
    switch (this) {
      case Role.superAdmin:
        return 'super_admin';
      case Role.admin:
        return 'admin';
      case Role.employee:
        return 'employee';
    }
  }

  String get label {
    switch (this) {
      case Role.superAdmin:
        return 'Super admin';
      case Role.admin:
        return 'Admin';
      case Role.employee:
        return 'Employee';
    }
  }

  bool get isAdmin => this == Role.admin || this == Role.superAdmin;
  bool get isSuperAdmin => this == Role.superAdmin;
}
