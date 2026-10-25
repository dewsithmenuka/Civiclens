import 'dart:io';

import 'package:civiclens/core/release_config.dart';

void main(List<String> args) {
  if (args.length != 2 ||
      !isSafeReleaseConfig(
        apiBase: args[0],
        privacyPolicyUrl: args[1],
      )) {
    stderr.writeln(
      'Release requires public HTTPS API and privacy-policy URLs; local, private, and example hosts are not allowed.',
    );
    exitCode = 1;
  }
}
