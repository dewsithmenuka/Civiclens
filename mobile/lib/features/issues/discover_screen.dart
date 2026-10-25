import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../map/status_pin.dart';

const _pageSize = 20;
const _statuses = [
  'REPORTED',
  'UNDER_REVIEW',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
];

class DiscoverScreen extends ConsumerStatefulWidget {
  const DiscoverScreen({super.key});

  @override
  ConsumerState<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends ConsumerState<DiscoverScreen> {
  final _search = TextEditingController();
  final List<Issue> _issues = [];
  Timer? _debounce;
  String? _category;
  String? _status;
  String? _error;
  int _total = 0;
  bool _loading = false;
  bool _loadingMore = false;
  bool _reloadRequested = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _filters => {
        if (_search.text.trim().isNotEmpty) 'q': _search.text.trim(),
        if (_category != null) 'category': _category,
        if (_status != null) 'status': _status,
      };

  Future<void> _load({bool more = false}) async {
    if (_loading || _loadingMore) {
      _reloadRequested = true;
      return;
    }
    _reloadRequested = false;
    setState(() {
      _error = null;
      if (more) {
        _loadingMore = true;
      } else {
        _loading = true;
        _issues.clear();
      }
    });
    final offset = more ? _issues.length : 0;
    try {
      final response = await ref.read(dioProvider).get(
        '/issues',
        queryParameters: {..._filters, 'limit': _pageSize, 'offset': offset},
      );
      final data = Map<String, dynamic>.from(response.data as Map);
      final found = (data['items'] as List)
          .map((item) => Issue.fromJson(Map<String, dynamic>.from(item as Map)))
          .toList();
      if (mounted) {
        setState(() {
          _issues.addAll(found);
          _total = data['total'] as int;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
        if (_reloadRequested) {
          _reloadRequested = false;
          _load();
        }
      }
    }
  }

  void _searchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _load());
  }

  void _changeFilter({String? category, String? status, bool clearCategory = false, bool clearStatus = false}) {
    setState(() {
      if (clearCategory || category != null) _category = category;
      if (clearStatus || status != null) _status = status;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final canLoadMore = !_loading && !_loadingMore && _issues.length < _total;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Discover reports'),
        actions: [
          IconButton(
            tooltip: 'Map view',
            onPressed: () => context.go('/'),
            icon: const Icon(Icons.map_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Column(
              children: [
                TextField(
                  controller: _search,
                  onChanged: _searchChanged,
                  onSubmitted: (_) {
                    _debounce?.cancel();
                    _load();
                  },
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search reports',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: 'Clear search',
                            onPressed: () {
                              _search.clear();
                              _load();
                            },
                            icon: const Icon(Icons.close),
                          ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String?>(
                        initialValue: _category,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Category'),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All categories')),
                          for (final entry in categories.entries)
                            DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                        ],
                        onChanged: (value) => _changeFilter(
                          category: value,
                          clearCategory: value == null,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String?>(
                        initialValue: _status,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Status'),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All statuses')),
                          for (final value in _statuses)
                            DropdownMenuItem(value: value, child: Text(statusLabel(value))),
                        ],
                        onChanged: (value) => _changeFilter(
                          status: value,
                          clearStatus: value == null,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? ListView(
                        children: [
                          const SizedBox(height: 80),
                          const Icon(Icons.cloud_off_outlined, size: 40, color: Tokens.muted),
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(_error!, textAlign: TextAlign.center),
                          ),
                          Center(child: TextButton(onPressed: () => _load(), child: const Text('Try again'))),
                        ],
                      )
                    : _issues.isEmpty
                        ? ListView(
                            children: const [
                              SizedBox(height: 80),
                              Icon(Icons.search_off, size: 48, color: Tokens.muted),
                              SizedBox(height: 12),
                              Center(child: Text('No reports match these filters.')),
                            ],
                          )
                        : ListView.separated(
                            itemCount: _issues.length + 1,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (context, index) {
                              if (index == _issues.length) {
                                if (_loadingMore) {
                                  return const Padding(
                                    padding: EdgeInsets.all(16),
                                    child: Center(child: CircularProgressIndicator()),
                                  );
                                }
                                return canLoadMore
                                    ? Padding(
                                        padding: const EdgeInsets.all(16),
                                        child: OutlinedButton(
                                          onPressed: () => _load(more: true),
                                          child: const Text('Load more'),
                                        ),
                                      )
                                    : Padding(
                                        padding: const EdgeInsets.all(16),
                                        child: Center(child: Text('${_issues.length} of $_total reports')),
                                      );
                              }
                              final issue = _issues[index];
                              return ListTile(
                                leading: StatusPin(category: issue.category, status: issue.status),
                                title: Text(issue.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                                subtitle: Text(
                                  '${categories[issue.category] ?? issue.category} · ${statusLabel(issue.status)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.push('/issues/${issue.id}'),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}
