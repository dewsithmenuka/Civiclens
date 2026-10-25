import 'package:civiclens/features/search/place_search.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Nominatim: parses lat/lon strings and the [south, north, west, east] box', () {
    final r = placesFromNominatim([
      {'display_name': 'Brooklyn Bridge, New York', 'lat': '40.7061', 'lon': '-73.9969', 'boundingbox': ['40.70', '40.71', '-74.00', '-73.99']},
    ]);
    expect(r, hasLength(1));
    expect(r.first.name, 'Brooklyn Bridge, New York');
    expect(r.first.point.latitude, closeTo(40.7061, 1e-9));
    expect(r.first.bounds!.south, closeTo(40.70, 1e-9));
    expect(r.first.bounds!.east, closeTo(-73.99, 1e-9));
  });

  test('Nominatim: skips broken entries instead of throwing', () {
    expect(placesFromNominatim([{'display_name': 'x'}, 'junk', {'lat': 'a', 'lon': 'b', 'display_name': 'y'}]), isEmpty);
    expect(placesFromNominatim(null), isEmpty);
    expect(placesFromNominatim({'not': 'a list'}), isEmpty);
  });

  test('Photon: coordinates are [lon, lat] and extent is [minLon, maxLat, maxLon, minLat]', () {
    final r = placesFromPhoton({
      'features': [
        {
          'geometry': {'coordinates': [13.3777, 52.5163]},
          'properties': {'name': 'Brandenburger Tor', 'street': 'Pariser Platz', 'housenumber': '1', 'city': 'Berlin', 'country': 'Germany', 'extent': [13.37, 52.52, 13.38, 52.51]},
        },
      ],
    });
    expect(r.single.point.latitude, closeTo(52.5163, 1e-9));
    expect(r.single.point.longitude, closeTo(13.3777, 1e-9));
    expect(r.single.name, 'Brandenburger Tor, Pariser Platz 1, Berlin, Germany');
    expect(r.single.bounds!.north, closeTo(52.52, 1e-9));
    expect(r.single.bounds!.west, closeTo(13.37, 1e-9));
  });

  test('Photon: never repeats a part of the label, and skips results with no usable name', () {
    expect(photonLabel({'name': 'Berlin', 'city': 'Berlin', 'country': 'Germany'}), 'Berlin, Germany');
    final r = placesFromPhoton({
      'features': [
        {'geometry': {'coordinates': [1, 2]}, 'properties': {}},
        {'geometry': {'coordinates': [1]}, 'properties': {'name': 'x'}},
        {'geometry': {'coordinates': [3, 4]}, 'properties': {'name': 'Ok'}},
      ],
    });
    expect(r.map((p) => p.name), ['Ok']);
    expect(placesFromPhoton(null), isEmpty);
  });
}