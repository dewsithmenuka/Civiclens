bool isSafeReleaseConfig({
  required String apiBase,
  required String privacyPolicyUrl,
}) {
  bool isPublicHost(String host) {
    final normalized = host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
    const reservedHosts = {
      'example.com',
      'example.net',
      'example.org',
      'localhost',
    };
    const reservedSuffixes = [
      '.invalid',
      '.example',
      '.test',
      '.localhost',
      '.local',
      '.internal',
      '.lan',
      '.example.com',
      '.example.net',
      '.example.org',
    ];

    return normalized.contains('.') &&
        !normalized.contains(':') &&
        !RegExp(r'^[0-9.]+$').hasMatch(normalized) &&
        !reservedHosts.contains(normalized) &&
        !reservedSuffixes.any(normalized.endsWith);
  }

  bool isHttpsUrl(String value, {bool originOnly = false}) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        uri.scheme == 'https' &&
        isPublicHost(uri.host) &&
        uri.userInfo.isEmpty &&
        (!originOnly || uri.path.isEmpty) &&
        !uri.hasQuery &&
        !uri.hasFragment;
  }

  return isHttpsUrl(apiBase, originOnly: true) && isHttpsUrl(privacyPolicyUrl);
}
