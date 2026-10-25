class Issue {
  final String id, category, title, status;
  final String? description;
  final double lat, lng;
  final int confirmationCount;
  final bool exact;
  final DateTime createdAt;

  Issue({
    required this.id, required this.category, required this.title, required this.status,
    required this.lat, required this.lng, required this.confirmationCount,
    required this.exact, required this.createdAt, this.description,
  });

  factory Issue.fromJson(Map<String, dynamic> j) => Issue(
        id: j['id'] as String,
        category: j['category'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        status: j['status'] as String,
        lat: (j['location']['lat'] as num).toDouble(),
        lng: (j['location']['lng'] as num).toDouble(),
        confirmationCount: j['confirmationCount'] as int,
        exact: j['locationPrecision'] == 'EXACT',
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

const categories = <String, String>{
  'ROADS': 'Roads',
  'LIGHTING': 'Lighting',
  'WATER': 'Water',
  'WASTE': 'Waste',
  'TRAFFIC': 'Traffic',
  'ACCESSIBILITY': 'Accessibility',
};