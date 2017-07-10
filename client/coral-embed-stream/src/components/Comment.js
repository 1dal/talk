import React, {PropTypes} from 'react';

import AuthorName from 'coral-plugin-author-name/AuthorName';
import TagLabel from 'coral-plugin-tag-label/TagLabel';
import PubDate from 'coral-plugin-pubdate/PubDate';
import {ReplyBox, ReplyButton} from 'coral-plugin-replies';
import {FlagComment} from 'coral-plugin-flags';
import {can} from 'coral-framework/services/perms';
import {TransitionGroup} from 'react-transition-group';
import cn from 'classnames';
import styles from './Comment.css';
import {THREADING_LEVEL} from '../constants/stream';
import merge from 'lodash/merge';
import mapValues from 'lodash/mapValues';

import {
  BestButton,
  IfUserCanModifyBest,
  BEST_TAG,
  commentIsBest,
  BestIndicator
} from 'coral-plugin-best/BestButton';
import LoadMore from './LoadMore';
import {getEditableUntilDate} from './util';
import {TopRightMenu} from './TopRightMenu';
import CommentContent from './CommentContent';
import Slot from 'coral-framework/components/Slot';
import IgnoredCommentTombstone from './IgnoredCommentTombstone';
import {EditableCommentContent} from './EditableCommentContent';
import {getActionSummary, iPerformedThisAction, forEachError} from 'coral-framework/utils';
import t from 'coral-framework/services/i18n';

const isStaff = (tags) => !tags.every((t) => t.tag.name !== 'STAFF');
const hasTag = (tags, lookupTag) => !!tags.filter((t) => t.tag.name === lookupTag).length;
const hasComment = (nodes, id) => nodes.some((node) => node.id === id);

// resetCursors will return the id cursors of the first and second newest comment in
// the current reply list. The cursors are used to dertermine which
// comments to show. The spare cursor functions as a backup in case one
// of the comments gets deleted.
function resetCursors(state, props) {
  const replies = props.comment.replies;
  if (replies && replies.nodes.length) {
    const idCursors = [replies.nodes[replies.nodes.length - 1].id];
    if (replies.nodes.length >= 2) {
      idCursors.push(replies.nodes[replies.nodes.length - 2].id);
    }
    return {idCursors};
  }
  return {idCursors: []};
}

// invalidateCursor is called whenever a comment is removed which is referenced
// by one of the 2 id cursors. It returns a new set of id cursors calculated
// using the help of the backup cursor.
function invalidateCursor(invalidated, state, props) {
  const alt = invalidated === 1 ? 0 : 1;
  const replies = props.comment.replies;
  const idCursors = [];
  if (state.idCursors[alt]) {
    idCursors.push(state.idCursors[alt]);
    const index = replies.nodes.findIndex((node) => node.id === idCursors[0]);
    const prevInLine = replies.nodes[index - 1];
    if (prevInLine) {
      idCursors.push(prevInLine.id);
    }
  }
  return {idCursors};
}

// hold actions links (e.g. Reply) along the comment footer
const ActionButton = ({children}) => {
  return (
    <span className="comment__action-button comment__action-button--nowrap">
      {children}
    </span>
  );
};

export default class Comment extends React.Component {

  constructor(props) {
    super(props);

    // timeout to keep track of Comment edit window expiration
    this.editWindowExpiryTimeout = null;
    this.onClickEdit = this.onClickEdit.bind(this);
    this.stopEditing = this.stopEditing.bind(this);
    this.state = {

      // Whether the comment should be editable (e.g. after a commenter clicking the 'Edit' button on their own comment)
      isEditing: false,
      replyBoxVisible: false,
      animateEnter: false,
      loadingState: '',
      ...resetCursors({}, props),
    };
  }

  componentWillReceiveProps(next) {
    const {comment: {replies: prevReplies}} = this.props;
    const {comment: {replies: nextReplies}} = next;
    if (
        prevReplies && nextReplies &&
        nextReplies.nodes.length < prevReplies.nodes.length
    ) {

      // Invalidate first cursor if referenced comment was removed.
      if (this.state.idCursors[0] && !hasComment(nextReplies.nodes, this.state.idCursors[0])) {
        this.setState(invalidateCursor(0, this.state, next));
      }

      // Invalidate second cursor if referenced comment was removed.
      if (this.state.idCursors[1] && !hasComment(nextReplies.nodes, this.state.idCursors[1])) {
        this.setState(invalidateCursor(1, this.state, next));
      }
    }
  }

  componentWillEnter(callback) {
    callback();
    const userId = this.props.currentUser ? this.props.currentUser.id : null;
    if (this.props.comment.id.indexOf('pending') >= 0) {
      return;
    }
    if (userId && this.props.comment.user.id === userId) {

      // This comment was just added by currentUser.
      if (Date.now() - Number(new Date(this.props.comment.created_at)) < 30 * 1000) {
        return;
      }
    }
    this.setState({animateEnter: true});
  }

  static propTypes = {

    // id of currently opened ReplyBox. tracked in Stream.js
    activeReplyBox: PropTypes.string.isRequired,
    disableReply: PropTypes.bool,
    setActiveReplyBox: PropTypes.func.isRequired,
    showSignInDialog: PropTypes.func.isRequired,
    postFlag: PropTypes.func.isRequired,
    deleteAction: PropTypes.func.isRequired,
    parentId: PropTypes.string,
    highlighted: PropTypes.string,
    addNotification: PropTypes.func.isRequired,
    postComment: PropTypes.func.isRequired,
    depth: PropTypes.number.isRequired,
    liveUpdates: PropTypes.bool,
    asset: PropTypes.object.isRequired,
    currentUser: PropTypes.shape({
      id: PropTypes.string.isRequired
    }),
    charCountEnable: PropTypes.bool.isRequired,
    maxCharCount: PropTypes.number,
    comment: PropTypes.shape({
      depth: PropTypes.number,
      action_summaries: PropTypes.array.isRequired,
      body: PropTypes.string.isRequired,
      id: PropTypes.string.isRequired,
      tags: PropTypes.arrayOf(
        PropTypes.shape({
          name: PropTypes.string
        })
      ),
      replies: PropTypes.object,
      user: PropTypes.shape({
        id: PropTypes.string.isRequired,
        username: PropTypes.string.isRequired
      }).isRequired,
      editing: PropTypes.shape({
        edited: PropTypes.bool,

        // ISO8601
        editableUntil: PropTypes.string,
      })
    }).isRequired,

    // given a comment, return whether it should be rendered as ignored
    commentIsIgnored: React.PropTypes.func,

    // dispatch action to add a tag to a comment
    addTag: React.PropTypes.func,

    // dispatch action to remove a tag from a comment
    removeTag: React.PropTypes.func,

    // dispatch action to ignore another user
    ignoreUser: React.PropTypes.func,

    // edit a comment, passed (id, asset_id, { body })
    editComment: React.PropTypes.func,
  }

  editComment = (...args) => {
    return this.props.editComment(this.props.comment.id, this.props.asset.id, ...args);
  }

  onClickEdit (e) {
    e.preventDefault();
    if (!can(this.props.currentUser, 'INTERACT_WITH_COMMUNITY')) {
      this.props.addNotification('error', t('error.NOT_AUTHORIZED'));
      return;
    }
    this.setState({isEditing: true});
  }

  stopEditing () {
    if (this._isMounted) {
      this.setState({isEditing: false});
    }
  }

  hasIgnoredReplies() {
    return this.props.comment.replies &&
      this.props.comment.replies.nodes.some((reply) => this.props.commentIsIgnored(reply));
  }

  loadNewReplies = () => {
    const {replies, replyCount, id} = this.props.comment;
    if (replyCount > replies.nodes.length) {
      this.setState({loadingState: 'loading'});
      this.props.loadMore(id)
        .then(() => {
          this.setState({
            ...resetCursors(this.state, this.props),
            loadingState: 'success',
          });
        })
        .catch((error) => {
          this.setState({loadingState: 'error'});
          forEachError(error, ({msg}) => {this.props.addNotification('error', msg);});
        });
      return;
    }
    this.setState(resetCursors);
  };

  showReplyBox = () => {
    if (!this.props.currentUser) {
      this.props.showSignInDialog();
      return;
    }
    if (can(this.props.currentUser, 'INTERACT_WITH_COMMUNITY')) {
      this.props.setActiveReplyBox(this.props.comment.id);
    } else {
      this.props.addNotification('error', t('error.NOT_AUTHORIZED'));
    }
    return;
  }

  // getVisibileReplies returns a list containing comments
  // which were authored by current user or comes before the `idCursor`.
  getVisibileReplies() {
    const {comment: {replies}, currentUser, liveUpdates} = this.props;
    const idCursor = this.state.idCursors[0];
    const userId = currentUser ? currentUser.id : null;

    if (!replies) {
      return [];
    }

    if (liveUpdates) {
      return replies.nodes;
    }

    const view = [];
    let pastCursor = false;
    replies.nodes.forEach((comment) => {
      if (idCursor && !pastCursor || comment.user.id === userId) {
        view.push(comment);
      }
      if (comment.id === idCursor) {
        pastCursor = true;
      }
    });
    return view;
  }

  componentDidMount() {
    this._isMounted = true;
    if (this.editWindowExpiryTimeout) {
      this.editWindowExpiryTimeout = clearTimeout(this.editWindowExpiryTimeout);
    }

    // if still in the edit window, set a timeout to re-render once it expires
    const msLeftToEdit = editWindowRemainingMs(this.props.comment);
    if (msLeftToEdit > 0) {
      this.editWindowExpiryTimeout = setTimeout(() => {

        // re-render
        this.setState(this.state);
      }, msLeftToEdit);
    }
  }
  componentWillUnmount() {
    if (this.editWindowExpiryTimeout) {
      this.editWindowExpiryTimeout = clearTimeout(this.editWindowExpiryTimeout);
    }
    this._isMounted = false;
  }
  render () {
    const {
      asset,
      depth,
      comment,
      postFlag,
      parentId,
      ignoreUser,
      highlighted,
      postComment,
      currentUser,
      postDontAgree,
      setActiveReplyBox,
      activeReplyBox,
      loadMore,
      deleteAction,
      disableReply,
      maxCharCount,
      addNotification,
      charCountEnable,
      showSignInDialog,
      addTag,
      removeTag,
      liveUpdates,
      commentIsIgnored,
      commentClassNames = []
    } = this.props;

    const view = this.getVisibileReplies();
    const {loadingState} = this.state;
    const isPending = comment.id.indexOf('pending') >= 0;
    const isHighlighted = highlighted === comment.id;

    const hasMoreComments = comment.replies && (comment.replies.hasNextPage || comment.replies.nodes.length > view.length);
    const moreRepliesCount = this.hasIgnoredReplies() ? -1 : comment.replyCount - view.length;
    const flagSummary = getActionSummary('FlagActionSummary', comment);
    const dontAgreeSummary = getActionSummary(
      'DontAgreeActionSummary',
      comment
    );
    let myFlag = null;
    if (iPerformedThisAction('FlagActionSummary', comment)) {
      myFlag = flagSummary.find((s) => s.current_user);
    } else if (iPerformedThisAction('DontAgreeActionSummary', comment)) {
      myFlag = dontAgreeSummary.find((s) => s.current_user);
    }

    // call a function, and if it errors, call addNotification('error', ...) (e.g. to show user a snackbar)
    const notifyOnError = (fn, errorToMessage) =>
      async function(...args) {
        if (typeof errorToMessage !== 'function') {
          errorToMessage = (error) => error.message;
        }
        try {
          return await fn(...args);
        } catch (error) {
          addNotification('error', errorToMessage(error));
          throw error;
        }
      };

    const addBestTag = notifyOnError(
      () =>
        addTag({
          id: comment.id,
          name: BEST_TAG,
          assetId: asset.id,
        }),
      () => 'Failed to tag comment as best'
    );

    const removeBestTag = notifyOnError(
      () =>
        removeTag({
          id: comment.id,
          name: BEST_TAG,
          assetId: asset.id,
        }),
      () => 'Failed to remove best comment tag'
    );

    /**
     * conditionClassNames
     * adds classNames based on condition
     * classnames is an array of objects with key as classnames and value as conditions
     * i.e:
     * {
     *  'myClassName': { tags: ['STAFF']}
     * }
     *
     * This will add myClassName to comments tagged with STAFF TAG.
     * **/
    const conditionalClassNames =
      mapValues(merge({}, ...commentClassNames), (condition) => {
        if (condition.tags) {
          return condition.tags.some((tag) => hasTag(comment.tags, tag));
        }
        return false;
      });

    const rootClassNames = [
      'talk-stream-comment-wrapper',
      `talk-stream-comment-wrapper-level-${depth}`,
      styles.root,
      styles[`rootLevel${depth}`],
      {
        ...conditionalClassNames,
        [styles.enter]: this.state.animateEnter,
      },
    ];

    return (
      <div
        className={cn(...rootClassNames)}
        id={`c_${comment.id}`}
      >
        <div
          className={cn(
            'talk-stream-comment',
            `talk-stream-comment-level-${depth}`,
            styles.comment,
            styles[`commentLevel${depth}`],
            {
              [styles.pendingComment]: isPending,
              [styles.highlightedComment]: isHighlighted,
              'talk-stream-pending-comment': isPending,
              'talk-stream-highlighted-comment': isHighlighted,
            }
          )}
        >
          <AuthorName author={comment.user} className={'talk-stream-comment-user-name'} />
          {isStaff(comment.tags) ? <TagLabel>Staff</TagLabel> : null}

          {commentIsBest(comment)
            ? <TagLabel><BestIndicator /></TagLabel>
            : null }

          <span className={`${styles.bylineSecondary} talk-stream-comment-user-byline`} >
            <PubDate created_at={comment.created_at} className={'talk-stream-comment-published-date'} />
            {
              (comment.editing && comment.editing.edited)
              ? <span>&nbsp;<span className={styles.editedMarker}>({t('comment.edited')})</span></span>
              : null
            }
          </span>

          <Slot
            className={styles.commentInfoBar}
            fill="commentInfoBar"
            depth={depth}
            comment={comment}
            commentId={comment.id}
            data={this.props.data}
            root={this.props.root}
            inline
          />

          { (currentUser && (comment.user.id === currentUser.id)) &&

            /* User can edit/delete their own comment for a short window after posting */
            <span className={cn(styles.topRight)}>
              {
                commentIsStillEditable(comment) &&
                <a
                  className={cn(styles.link, {[styles.active]: this.state.isEditing})}
                  onClick={this.onClickEdit}>Edit</a>
              }
            </span>
          }
          { (currentUser && (comment.user.id !== currentUser.id)) &&

              /* TopRightMenu allows currentUser to ignore other users' comments */
              <span className={cn(styles.topRight, styles.topRightMenu)}>
                <TopRightMenu
                  comment={comment}
                  ignoreUser={ignoreUser}
                  addNotification={addNotification} />
              </span>
          }
          {
            this.state.isEditing
            ? <EditableCommentContent
                editComment={this.editComment}
                addNotification={addNotification}
                comment={comment}
                currentUser={currentUser}
                charCountEnable={charCountEnable}
                maxCharCount={maxCharCount}
                parentId={parentId}
                stopEditing={this.stopEditing}
                />
            : <div>
                <Slot fill="commentContent" comment={comment} defaultComponent={CommentContent} />
              </div>
          }

          <div className="commentActionsLeft comment__action-container">
            <Slot
              fill="commentReactions"
              data={this.props.data}
              root={this.props.root}
              comment={comment}
              commentId={comment.id}
              inline
            />
            <ActionButton>
              <IfUserCanModifyBest user={currentUser}>
                <BestButton
                  isBest={commentIsBest(comment)}
                  addBest={addBestTag}
                  removeBest={removeBestTag}
                />
              </IfUserCanModifyBest>
            </ActionButton>
            {!disableReply &&
              <ActionButton>
                <ReplyButton
                  onClick={this.showReplyBox}
                  parentCommentId={parentId || comment.id}
                  currentUserId={currentUser && currentUser.id}
                />
              </ActionButton>}
          </div>
          <div className="commentActionsRight comment__action-container">
            <Slot
              fill="commentActions"
              wrapperComponent={ActionButton}
              data={this.props.data}
              root={this.props.root}
              asset={asset}
              comment={comment}
              commentId={comment.id}
              inline
            />
            <ActionButton>
              <FlagComment
                flaggedByCurrentUser={!!myFlag}
                flag={myFlag}
                id={comment.id}
                author_id={comment.user.id}
                postFlag={postFlag}
                addNotification={addNotification}
                postDontAgree={postDontAgree}
                deleteAction={deleteAction}
                showSignInDialog={showSignInDialog}
                currentUser={currentUser}
              />
            </ActionButton>
          </div>
        </div>
        {activeReplyBox === comment.id
          ? <ReplyBox
              commentPostedHandler={() => {
                setActiveReplyBox('');
              }}
              charCountEnable={charCountEnable}
              maxCharCount={maxCharCount}
              setActiveReplyBox={setActiveReplyBox}
              parentId={(depth < THREADING_LEVEL) ? comment.id : parentId}
              addNotification={addNotification}
              postComment={postComment}
              currentUser={currentUser}
              assetId={asset.id}
            />
          : null}

        <TransitionGroup>
        {view.map((reply) => {
          return commentIsIgnored(reply)
            ? <IgnoredCommentTombstone key={reply.id} />
            : <Comment
                data={this.props.data}
                root={this.props.root}
                setActiveReplyBox={setActiveReplyBox}
                disableReply={disableReply}
                activeReplyBox={activeReplyBox}
                addNotification={addNotification}
                parentId={comment.id}
                postComment={postComment}
                editComment={this.props.editComment}
                depth={depth + 1}
                asset={asset}
                highlighted={highlighted}
                currentUser={currentUser}
                postFlag={postFlag}
                deleteAction={deleteAction}
                addTag={addTag}
                removeTag={removeTag}
                loadMore={loadMore}
                ignoreUser={ignoreUser}
                charCountEnable={charCountEnable}
                maxCharCount={maxCharCount}
                showSignInDialog={showSignInDialog}
                commentIsIgnored={commentIsIgnored}
                liveUpdates={liveUpdates}
                key={reply.id}
                comment={reply}
              />;
        })}
        </TransitionGroup>
        <div className="talk-load-more-replies">
          <LoadMore
            topLevel={false}
            replyCount={moreRepliesCount}
            moreComments={hasMoreComments}
            loadMore={this.loadNewReplies}
            loadingState={loadingState}
          />
        </div>
      </div>
    );
  }
}

// return whether the comment is editable
function commentIsStillEditable (comment) {
  const editing = comment && comment.editing;
  if (!editing) {return false;}
  const editableUntil = getEditableUntilDate(comment);
  const editWindowExpired = (editableUntil - new Date) < 0;
  return !editWindowExpired;
}

// return number of milliseconds before edit window expires
function editWindowRemainingMs (comment) {
  const editableUntil = getEditableUntilDate(comment);
  if (!editableUntil) {return;}
  const now = new Date();
  const editWindowRemainingMs = (editableUntil - now);
  return editWindowRemainingMs;
}
