/*
 * Copyright (C) 2016 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import $ from 'jquery'

import {asJson, consumePrefetchedXHR} from '@instructure/js-utils'

import StudentContentDataLoader from './StudentContentDataLoader'

function getStudentIds(courseId) {
  if (ENV.prefetch_gradebook_user_ids) {
    /*
     * When user ids have been prefetched, the data is only known valid for the
     * first request. Consume it by pulling it out of the prefetch store, which
     * will force all subsequent requests for user ids to call through the
     * network.
     */
    const promise = consumePrefetchedXHR('user_ids')
    if (promise) {
      return asJson(promise)
    }
  }

  const url = `/courses/${courseId}/gradebook/user_ids`
  return $.ajaxJSON(url, 'GET', {})
}

function getGradingPeriodAssignments(courseId) {
  const url = `/courses/${courseId}/gradebook/grading_period_assignments`
  return $.ajaxJSON(url, 'GET', {})
}

function getAssignmentGroups(options, dispatch) {
  const url = `/api/v1/courses/${options.courseId}/assignment_groups`
  const params = {
    exclude_assignment_submission_types: ['wiki_page'],
    exclude_response_fields: ['description', 'in_closed_grading_period', 'needs_grading_count'],
    include: [
      'assignment_group_id',
      'assignment_visibility',
      'assignments',
      'grades_published',
      'module_ids',
      'post_manually'
    ],
    override_assignment_dates: false
  }

  return dispatch.getDepaginated(url, params)
}

function getContextModules(courseId, dispatch) {
  const url = `/api/v1/courses/${courseId}/modules`
  return dispatch.getDepaginated(url)
}

function getCustomColumns(url, dispatch) {
  return dispatch.getDepaginated(url, {include_hidden: true})
}

// This function is called from showNoteColumn in Gradebook.coffee
// when the notes column is revealed. In that case dispatch won't
// exist so we'll create a new Dispatcher for this request.
function getDataForColumn(columnId, url, params, cb, dispatch) {
  const columnUrl = url.replace(/:id/, columnId)
  const augmentedCallback = data => cb(columnId, data)
  return dispatch.getDepaginated(columnUrl, params, augmentedCallback)
}

function getCustomColumnData(options, customColumnsDfd, waitForDfds, dispatch) {
  const url = options.customColumnDataURL
  const params = options.customColumnDataParams
  const cb = options.customColumnDataPageCb
  const customColumnDataLoaded = $.Deferred()

  if (url) {
    // waitForDfds ensures that custom column data is loaded *last*
    $.when(...waitForDfds).then(() => {
      if (options.customColumnIds) {
        const customColumnDataDfds = options.customColumnIds.map(columnId =>
          getDataForColumn(columnId, url, params, cb, dispatch)
        )
        $.when(...customColumnDataDfds).then(() => customColumnDataLoaded.resolve())
      } else {
        customColumnsDfd.then(customColumns => {
          const customColumnDataDfds = customColumns.map(col =>
            getDataForColumn(col.id, url, params, cb, dispatch)
          )
          $.when(...customColumnDataDfds).then(() => customColumnDataLoaded.resolve())
        })
      }
    })
  }

  return customColumnDataLoaded
}

function loadGradebookData(opts) {
  const {dispatch} = opts

  const gotAssignmentGroups = opts.getAssignmentGroups ? getAssignmentGroups(opts, dispatch) : null

  // Begin loading Students before any other data.
  const gotStudentIds = getStudentIds(opts.courseId)
  let gotGradingPeriodAssignments
  if (opts.getGradingPeriodAssignments) {
    gotGradingPeriodAssignments = getGradingPeriodAssignments(opts.courseId)
  }
  const gotCustomColumns = getCustomColumns(opts.customColumnsURL, dispatch)

  const studentContentDataLoader = new StudentContentDataLoader(
    {
      courseId: opts.courseId,
      gradebook: opts.gradebook,
      loadedStudentIds: opts.loadedStudentIds,
      studentsChunkSize: opts.perPage,
      submissionsChunkSize: opts.submissionsChunkSize
    },
    dispatch
  )

  const gotContextModules = opts.getContextModules
    ? getContextModules(opts.courseId, dispatch)
    : null

  const gotStudents = $.Deferred()
  const gotSubmissions = $.Deferred()

  Promise.resolve(gotStudentIds)
    .then(data => studentContentDataLoader.load(data.user_ids))
    .then(() => {
      gotStudents.resolve()
      gotSubmissions.resolve()
    })

  // Custom Column Data will load only after custom columns and all submissions.
  const gotCustomColumnData = getCustomColumnData(
    opts,
    gotCustomColumns,
    [gotSubmissions],
    dispatch
  )

  return {
    gotAssignmentGroups,
    gotContextModules,
    gotCustomColumns,
    gotGradingPeriodAssignments,
    gotStudentIds,
    gotStudents,
    gotSubmissions,
    gotCustomColumnData
  }
}

export default {
  getDataForColumn,
  loadGradebookData
}