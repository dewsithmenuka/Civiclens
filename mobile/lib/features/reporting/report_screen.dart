import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../../app/theme.dart';
import '../../core/models.dart';
import 'report_queue.dart';

class ReportScreen extends ConsumerStatefulWidget {
  /// If set (long-press on the map), the report starts at this point
  /// instead of the GPS fix.
  final LatLng? initial;

  const ReportScreen({super.key, this.initial});

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen>
    with WidgetsBindingObserver {
  final _title = TextEditingController();
  final _desc = TextEditingController();

  String _category = 'ROADS';
  final List<String> _photos = [];

  LatLng? _point;
  bool _fromGps = false;
  bool _locationConfirmed = false;
  String? _locError;
  bool _saving = false;
  bool _addingPhoto = false;
  bool _queued = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    if (widget.initial != null) {
      _point = widget.initial;
      _locationConfirmed = true;
    } else {
      _locate();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _title.dispose();
    _desc.dispose();
    if (!_queued) unawaited(_deletePhotos(List.of(_photos)));
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _fromGps) {
      Geolocator.checkPermission().then((permission) {
        if (mounted &&
            (permission == LocationPermission.denied ||
                permission == LocationPermission.deniedForever)) {
          setState(() {
            _locError =
                'Location access was turned off. Confirm the existing spot or choose one on the map.';
          });
        }
      });
    }
  }

  Future<void> _deletePhotos(Iterable<String> paths) async {
    for (final path in paths) {
      try {
        final file = File(path);
        if (await file.exists()) await file.delete();
      } catch (error) {
        debugPrint('Could not clean up report photo: $error');
      }
    }
  }

  Future<void> _locate() async {
    if (mounted) {
      setState(() => _locError = null);
    }

    try {
      var permission = await Geolocator.checkPermission();

      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(() {
            _locError =
                'Location permission is off. Pick the spot on the map instead.';
          });
        }
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        timeLimit: const Duration(seconds: 12),
      );

      if (mounted) {
        setState(() {
          _point = LatLng(position.latitude, position.longitude);
          _fromGps = true;
          _locationConfirmed = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _locError = 'Could not get your location: $error';
        });
      }
    }
  }

  Future<void> _pickOnMap() async {
    final start = _point ?? const LatLng(40.7128, -74.0060);

    final picked = await context.push<LatLng>(
      '/pick-location',
      extra: start,
    );

    if (picked != null && mounted) {
      setState(() {
        _point = picked;
        _fromGps = false;
        _locationConfirmed = true;
        _locError = null;
      });
    }
  }

  Future<void> _addPhoto(ImageSource source) async {
    if (_photos.length >= 4 || _addingPhoto) return;

    setState(() => _addingPhoto = true);
    try {
      // Compress on-device to keep uploads small on poor connections.
      final image = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1600,
        imageQuality: 80,
      );

      if (image == null) return;

      // Copy out of the volatile cache so queued reports survive restarts.
      final directory = await getApplicationDocumentsDirectory();
      final extension = image.path.split('.').last.toLowerCase();
      if (!{'jpg', 'jpeg', 'png'}.contains(extension)) {
        throw const FormatException('Choose a JPEG or PNG photo.');
      }
      final destination = '${directory.path}/${const Uuid().v4()}.$extension';

      await File(image.path).copy(destination);
      if (await File(destination).length() > 5 * 1024 * 1024) {
        await File(destination).delete();
        throw const FormatException('Photos must be 5 MB or smaller.');
      }

      if (!mounted) {
        // The screen was closed while the image was being copied.
        await File(destination).delete();
        return;
      }

      setState(() => _photos.add(destination));
    } catch (e) {
      if (!mounted) return;

      final message = e is FormatException ? e.message : e.toString();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not add photo: $message')),
      );
    } finally {
      if (mounted) setState(() => _addingPhoto = false);
    }
  }

  Future<void> _removePhoto(String photo) async {
    setState(() => _photos.remove(photo));
    await _deletePhotos([photo]);
  }

  Future<void> _submit() async {
    if (_title.text.trim().length < 3 || _point == null || _saving) {
      return;
    }

    setState(() => _saving = true);

    final id = const Uuid().v4();
    try {
      await ref.read(reportQueueProvider.notifier).add(
            PendingReport(
              id: id, // Idempotency key for this report.
              category: _category,
              title: _title.text.trim(),
              description: _desc.text.trim(),
              lat: _point!.latitude,
              lng: _point!.longitude,
              imagePaths: List.of(_photos),
            ),
          );
      _queued = true;
    } on QueueFullException catch (e) {
      _queued = ref.read(reportQueueProvider).any((report) => report.id == id);
      if (!mounted) return;

      setState(() => _saving = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );

      return;
    } catch (e) {
      _queued = ref.read(reportQueueProvider).any((report) => report.id == id);
      if (!mounted) return;

      setState(() => _saving = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save report: $e')),
      );

      return;
    }

    if (!mounted) return;

    context.pop();

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Report saved — sending now'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ready = _point != null &&
        _locationConfirmed &&
        _title.text.trim().length >= 3 &&
        !_saving;

    final locationText = _point == null
        ? (_locError ?? 'Finding your location…')
        : '${_fromGps ? 'Your current location' : 'Location chosen on the map'} · '
            '${_point!.latitude.toStringAsFixed(5)}, '
            '${_point!.longitude.toStringAsFixed(5)}';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Report an issue'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Category',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in categories.entries)
                ChoiceChip(
                  avatar: Icon(categoryIcon(entry.key), size: 18),
                  label: Text(entry.value),
                  selected: _category == entry.key,
                  onSelected: (_) {
                    setState(() => _category = entry.key);
                  },
                ),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _title,
            maxLength: 120,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'What is the problem?',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _desc,
            maxLines: 3,
            maxLength: 2000,
            decoration: const InputDecoration(
              labelText: 'Details (optional)',
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 88,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final photo in _photos)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: Image.file(
                            File(photo),
                            width: 88,
                            height: 88,
                            fit: BoxFit.cover,
                          ),
                        ),
                        Positioned(
                          right: 0,
                          top: 0,
                          child: IconButton(
                            tooltip: 'Remove photo',
                            iconSize: 18,
                            style: IconButton.styleFrom(
                              backgroundColor: Colors.black54,
                              foregroundColor: Colors.white,
                            ),
                            onPressed: () => _removePhoto(photo),
                            icon: const Icon(Icons.close),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (_photos.length < 4) ...[
                  _PhotoButton(
                    icon: Icons.photo_camera_outlined,
                    label: 'Camera',
                    onTap: _addingPhoto
                        ? () {}
                        : () => _addPhoto(ImageSource.camera),
                  ),
                  const SizedBox(width: 8),
                  _PhotoButton(
                    icon: Icons.photo_library_outlined,
                    label: 'Gallery',
                    onTap: _addingPhoto
                        ? () {}
                        : () => _addPhoto(ImageSource.gallery),
                  ),
                ],
              ],
            ),
          ),
          if (_addingPhoto) ...[
            const SizedBox(height: 8),
            const LinearProgressIndicator(),
          ],
          const SizedBox(height: 20),
          const Text(
            'Location',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(
                _point != null ? Icons.place : Icons.location_off_outlined,
                color: _point != null ? Tokens.accent : Tokens.danger,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  locationText,
                  style: const TextStyle(color: Tokens.muted),
                ),
              ),
            ],
          ),
          if (_locError != null && _point != null) ...[
            const SizedBox(height: 4),
            Text(
              _locError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 4),
          const Text(
            'Shown publicly as an approximate location.',
            style: TextStyle(
              color: Tokens.muted,
              fontSize: 12,
            ),
          ),
          if (_point != null && !_locationConfirmed) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => setState(() => _locationConfirmed = true),
              icon: const Icon(Icons.check_circle_outline),
              label: const Text('Confirm this location'),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _locate,
                  icon: const Icon(Icons.my_location),
                  label: const Text('My location'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickOnMap,
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('Pick on map'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: ready ? _submit : null,
            child: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Text('Submit report'),
          ),
          const SizedBox(height: 8),
          const Text(
            'No signal? Your report is saved on this device and sent '
            'automatically when you reconnect.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Tokens.muted,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _PhotoButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _PhotoButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: 'Add a photo from the $label',
        excludeSemantics: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              border: Border.all(color: Tokens.border),
              borderRadius: BorderRadius.circular(14),
              color: Tokens.surface,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: Tokens.muted),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      );
}
