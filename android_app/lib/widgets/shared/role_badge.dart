import 'package:flutter/material.dart';

import '../../models/role.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';

enum RoleBadgeSize { sm, xs }

/// Port of components/RoleBadge.jsx — renders nothing for a plain employee.
class RoleBadge extends StatelessWidget {
  const RoleBadge({
    super.key,
    required this.role,
    this.size = RoleBadgeSize.sm,
  });

  final Role role;
  final RoleBadgeSize size;

  @override
  Widget build(BuildContext context) {
    if (role == Role.employee) return const SizedBox.shrink();

    final color = role == Role.superAdmin ? Palette.warn : Palette.brand;
    final fontSize = size == RoleBadgeSize.xs ? 9.0 : 10.0;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(AppRadii.xs),
      ),
      child: Text(
        role.label,
        style: TextStyle(
          color: color,
          fontSize: fontSize,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
