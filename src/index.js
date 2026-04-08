const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    // === INPUTS ===
    const artifactPrefix = core.getInput('artifact-prefix');
    const artifactExtension = core.getInput('artifact-extension');
    const releaseVersion = core.getInput('release-version');
    const prerelease = core.getInput('prerelease') === 'true';
    const assets = core.getInput('assets');
    const token = core.getInput('token');
    const artifactName = `${artifactPrefix}.${artifactExtension}`;
    let tagName = '';

    core.debug(`Inputs: artifactPrefix=${artifactPrefix}, artifactExtension=${artifactExtension}, releaseVersion=${releaseVersion}, prerelease=${prerelease}, assets=${assets}, token=${token ? '***' : 'undefined'}`);

    // --- Validate version format ---
   if (!/^v\d+\.\d+\.\d-rc.\d*$/.test(releaseVersion)) {
      core.setFailed('Version must be in the format vX.Y.Z-rc.N (e.g., v1.0.0-rc.1).');
      return;
   }

    // --- List all tags and check if release tag exists ---
    const tagList = execSync('git for-each-ref --format="%(refname:short) %(objectname)" refs/tags').toString();
    core.info('Tags with SHAs:\n' + tagList);

    const existingTags = execSync(`git tag -l ${releaseVersion}`).toString().split('\n').map(t => t.trim()).filter(Boolean);
    core.info(`Existing tags: ${existingTags.join(', ')}`);
    if (existingTags.includes(releaseVersion)) {
      core.setFailed(`Tag ${releaseVersion} already exists.`);
      return;
    }

    // --- Get current commit SHA ---
    const commitSha = execSync('git log -1 --format=%H').toString().trim();
    core.info(`Info: Current commit SHA: ${commitSha}`);

    // --- Check if the commit is already tagged with a prerelease tag for this version ---
    let prereleaseTag = '';
    if (prerelease) {
      const tagsContainingCommit = execSync(`git tag --points-at ${commitSha}`).toString().split('\n').map(t => t.trim()).filter(Boolean);
      core.info(`Tags pointing directly at current commit: ${tagsContainingCommit.join(', ')}`);
      const matchingTag = tagsContainingCommit.find(tag => tag.includes(releaseVersion));
      if (matchingTag) {
        tagName = matchingTag;
        core.info(`Info: Current commit already has a prerelease tag ${tagName}`);
      } else {
        core.info(`Info: Creating a new prerelease tag for version ${releaseVersion}`);
        // Count existing rc tags for this version
        //const rcTags = execSync(`git tag -l "${releaseVersion}-rc.*"`).toString().split('\n').map(t => t.trim()).filter(Boolean);
        const rcTags = execSync(`git tag -l "${releaseVersion}*"`).toString().split('\n').map(t => t.trim()).filter(Boolean);
        core.debug(`RC tags for this version: ${rcTags.join(', ')}`);
        let incremental = rcTags.length > 0 ? rcTags.length + 1 : 1;
        //tagName = `${releaseVersion}-rc.${incremental}`;
        tagName = `${releaseVersion}`;
        core.info(`Info: Incremental prerelease tag is ${tagName}`);
        // Create the tag
        execSync(`git tag ${tagName} ${commitSha}`);
        execSync(`git push origin ${tagName}`);
      }
    } else {
      tagName = releaseVersion;
    }

    // --- Add prerelease version to step summary ---
    core.summary.addHeading('Prerelease Version').addRaw(`${tagName} :rocket:`).write();

    // --- Create GitHub Release using octokit ---
    const octokit = github.getOctokit(token);

    // --- Set tag and target commit for release ---
    const targetCommitish = github.context.payload.pull_request
      ? github.context.payload.pull_request.head.sha
      : github.context.sha;

    core.debug(`typeof tagName: ${typeof tagName}, value: "${tagName}"`);
    core.debug(`typeof targetCommitish: ${typeof targetCommitish}, value: "${targetCommitish}"`);

    // --- Asset path for release upload ---
    const assetName = `${artifactPrefix}-${tagName}.${artifactExtension}`;
    core.debug(`Asset path for upload: ${assetName}`);

    // --- Find previous tag for changelog generation ---
    let previousTag = '';
    try {
      // List tags sorted by creation date, filter out current tagName
      const allTags = execSync('git tag --sort=-creatordate').toString().split('\n').map(t => t.trim()).filter(Boolean);
      core.debug(`All tags: ${allTags.join(', ')}`);
      previousTag = allTags.find(tag => tag !== tagName && tag !== releaseVersion) || '';
      core.debug(`Previous tag found: ${previousTag}`);
    } catch (err) {
      core.warning('Could not determine previous tag for changelog.');
      core.debug(err.stack || err.message);
    }

    // --- Generate changelog ---
    let changelog = '';
    try {
      if (previousTag) {
        core.info(`Previous tag found: ${previousTag}`);
        changelog = execSync(`git log ${previousTag}..${commitSha} --pretty=format:"- %s (%an)"`).toString();
      } else {
        core.info('No previous tag found, changelog will include all history.');
        changelog = execSync(`git log --pretty=format:"- %s (%an)"`).toString();
      }
      if (!changelog.trim()) {
        changelog = 'No changes since last release.';
      }
      core.info('Changelog generated.');
    } catch (err) {
      changelog = 'Unable to generate changelog.';
      core.warning(changelog);
      core.debug(err.stack || err.message);
    }

    // --- Prepare release parameters ---
    const releaseParams = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      tag_name: tagName,
      target_commitish: targetCommitish,
      name: tagName,
      body: changelog,
      draft: false,
      prerelease: prerelease,
      make_latest: "false"
    };

    core.debug(`DEBUG release params:
      tagName: "${tagName}"
      targetCommitish: "${targetCommitish}"
      name: "${tagName}"
      body: "${changelog && changelog.substring(0, 100)}..."
      draft: ${false}
      prerelease: ${prerelease}
      make_latest: "false"
    `);

    if (!tagName || typeof tagName !== 'string' || !tagName.trim()) {
      core.setFailed('Release tagName is empty or invalid.');
      return;
    }

    // --- Check if a release already exists for this tag using listReleases only ---
    const releases = await octokit.rest.repos.listReleases({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      per_page: 100
    });
    const existingRelease = releases.data.find(r => r.tag_name === tagName);
    if (existingRelease) {
      if (existingRelease.prerelease || existingRelease.draft) {
        // --- Update existing prerelease ---
        core.info(`Updating existing prerelease for tag ${tagName}...`);
        await octokit.rest.repos.updateRelease({
          ...releaseParams,
          release_id: existingRelease.id
        });
        core.info(`Prerelease updated: ${existingRelease.html_url}`);
        // --- Upload asset to updated prerelease ---
        if (fs.existsSync(artifactName)) {
          core.info(`Uploading asset to updated prerelease: ${assetName}`);
          const assetData = fs.readFileSync(artifactName);
          await uploadReleaseAsset(octokit, existingRelease.upload_url, assetData, assetName);
          core.info(`Asset uploaded to updated prerelease.`);
        }
      } else {
        core.setFailed(`A published release already exists for tag ${tagName}: ${existingRelease.html_url}`);
        return;
      }
    } else {
      core.info(`No release found for tag ${tagName}, will create a new one.`);

      // --- Create new release ---
      const releaseResponse = await octokit.rest.repos.createRelease({
        ...releaseParams
      });

      core.info(`Release created: ${releaseResponse.data.html_url}`);

      // --- Upload asset to new release if exists ---
      if (fs.existsSync(artifactName)) {
        const assetData = fs.readFileSync(artifactName);
        await uploadReleaseAsset(octokit, releaseResponse.data.upload_url, assetData, assetName);
      }
    }

    // --- Set outputs for downstream steps ---
    core.setOutput('artifact-prefix', artifactPrefix);
    core.setOutput('artifact-extension', artifactExtension);
    core.setOutput('prerelease-version', tagName);
  } catch (error) {
    core.setFailed(error.stack || error.message);
  }
}

// --- Helper function to upload a release asset ---
async function uploadReleaseAsset(octokit, uploadUrl, assetData, assetName) {
  core.debug(`assetName: "${assetName}"`);
  if (!assetName || !assetName.trim()) {
    core.setFailed('Asset name is empty or invalid.');
    return;
  }
  if (!assetData || !Buffer.isBuffer(assetData)) {
    core.setFailed('Asset data is empty or invalid.');
    return;
  }

  // --- Overwrite asset if it already exists ---
  const match = uploadUrl.match(/releases\/(\d+)\/assets/);
  if (match) {
    const releaseId = match[1];
    // List existing assets for this release
    const assetsResp = await octokit.rest.repos.listReleaseAssets({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      release_id: releaseId
    });
    const existingAsset = assetsResp.data.find(a => a.name === assetName);
    if (existingAsset) {
      core.info(`Asset "${assetName}" already exists (id: ${existingAsset.id}), deleting before upload...`);
      await octokit.rest.repos.deleteReleaseAsset({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        asset_id: existingAsset.id
      });
      core.info(`Deleted existing asset "${assetName}".`);
    }
  }
  const params = {
    url: uploadUrl,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': assetData.length
    },
    name: assetName,
    data: assetData
  };
  core.debug(`uploadReleaseAsset params: ${JSON.stringify({ ...params, data: '[binary omitted]' })}`);
  const response = await octokit.rest.repos.uploadReleaseAsset(params);
  core.info(`Asset uploaded: ${response.data.browser_download_url}`);
}

run();
