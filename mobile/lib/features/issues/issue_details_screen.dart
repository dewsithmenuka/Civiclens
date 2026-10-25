import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../map/status_pin.dart';

class IssueDetailsScreen extends ConsumerStatefulWidget {
  const IssueDetailsScreen({super.key, required this.issueId});
  final String issueId;

  @override
  ConsumerState<IssueDetailsScreen> createState() => _IssueDetailsScreenState();
}

class _IssueDetailsScreenState extends ConsumerState<IssueDetailsScreen> {
  Map<String, dynamic>? _issue;
  String? _error;
  bool _loading = true;
  bool _following = false;
  bool _followBusy = false;
  bool _confirmBusy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final dio = ref.read(dioProvider);
      final response = await dio.get('/issues/${widget.issueId}');
      final following = await dio.get('/issues/${widget.issueId}/follow');
      if (!mounted) return;
      setState(() {
        _issue = Map<String, dynamic>.from(response.data as Map);
        _following = (following.data as Map)['following'] == true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleFollow() async {
    if (_followBusy) return;
    setState(() => _followBusy = true);
    try {
      final next = !_following;
      final dio = ref.read(dioProvider);
      if (next) {
        await dio.post('/issues/${widget.issueId}/follow');
      } else {
        await dio.delete('/issues/${widget.issueId}/follow');
      }
      if (mounted) setState(() => _following = next);
    } catch (error) {
      if (mounted) _message(errorMessage(error));
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  Future<void> _confirm() async {
    if (_confirmBusy) return;
    setState(() => _confirmBusy = true);
    try {
      final response =
          await ref.read(dioProvider).post('/issues/${widget.issueId}/confirm');
      if (mounted && _issue != null) {
        setState(() =>
            _issue!['confirmationCount'] = response.data['confirmationCount']);
        _message('Thanks — confirmation recorded');
      }
    } catch (error) {
      if (mounted) _message(errorMessage(error));
    } finally {
      if (mounted) setState(() => _confirmBusy = false);
    }
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final issue = _issue;
    return Scaffold(
      appBar: AppBar(title: const Text('Report details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined,
                            size: 44, color: Tokens.muted),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center),
                        TextButton(
                            onPressed: _load, child: const Text('Try again')),
                      ],
                    ),
                  ),
                )
              : issue == null
                  ? const SizedBox.shrink()
                  : _details(issue),
    );
  }

  Widget _details(Map<String, dynamic> issue) {
    final status = issue['status'] as String;
    final location = Map<String, dynamic>.from(issue['location'] as Map);
    final images = List<Map<String, dynamic>>.from(
      (issue['images'] as List? ?? const [])
          .map((item) => Map<String, dynamic>.from(item as Map)),
    );
    final timeline = List<Map<String, dynamic>>.from(
      (issue['timeline'] as List? ?? const [])
          .map((item) => Map<String, dynamic>.from(item as Map)),
    );
    final closed = {'RESOLVED', 'DUPLICATE', 'REJECTED'}.contains(status);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Row(
          children: [
            Icon(categoryIcon(issue['category'] as String),
                color: statusColor(status)),
            const SizedBox(width: 8),
            Expanded(
                child: Text(issue['category'] as String,
                    style: const TextStyle(color: Tokens.muted))),
            Chip(label: Text(statusLabel(status))),
          ],
        ),
        const SizedBox(height: 12),
        Text(issue['title'] as String,
            style: Theme.of(context).textTheme.headlineSmall),
        if ((issue['description'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 12),
          Text(issue['description'] as String),
        ],
        const SizedBox(height: 12),
        Text(
          '${issue['confirmationCount']} confirmations · '
          '${issue['locationPrecision'] == 'EXACT' ? 'exact' : 'approximate'} location',
          style: const TextStyle(color: Tokens.muted),
        ),
        const SizedBox(height: 8),
        Text(
          '${(location['lat'] as num).toStringAsFixed(5)}, '
          '${(location['lng'] as num).toStringAsFixed(5)}',
          style: const TextStyle(color: Tokens.muted),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () => context.go(
              '/',
              extra: LatLng(
                (location['lat'] as num).toDouble(),
                (location['lng'] as num).toDouble(),
              ),
            ),
            icon: const Icon(Icons.map_outlined),
            label: const Text('View on map'),
          ),
        ),
        if (images.isNotEmpty) ...[
          const SizedBox(height: 20),
          SizedBox(
            height: 220,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: images.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (context, index) => ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.network(
                  images[index]['url'] as String,
                  width: 280,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 280,
                    color: Tokens.border,
                    alignment: Alignment.center,
                    child: const Icon(Icons.broken_image_outlined,
                        size: 40, color: Tokens.muted),
                  ),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _followBusy ? null : _toggleFollow,
                icon: Icon(_following
                    ? Icons.notifications_off_outlined
                    : Icons.notifications_active_outlined),
                label: Text(_following ? 'Unfollow' : 'Follow updates'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton.icon(
                onPressed: closed || _confirmBusy ? null : _confirm,
                icon: const Icon(Icons.check_circle_outline),
                label: const Text('I see this too'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 28),
        Text('Status timeline', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (timeline.isEmpty)
          const Text('No status updates yet.',
              style: TextStyle(color: Tokens.muted))
        else
          for (final item in timeline)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.circle, size: 12, color: Tokens.accent),
              title: Text(statusLabel(item['to'] as String)),
              subtitle: Text([
                if (item['from'] != null)
                  'From ${statusLabel(item['from'] as String)}',
                if ((item['note'] as String?)?.isNotEmpty == true)
                  item['note'] as String,
                DateTime.parse(item['at'] as String)
                    .toLocal()
                    .toString()
                    .split('.')
                    .first,
              ].join(' · ')),
            ),
      ],
    );
  }
}
