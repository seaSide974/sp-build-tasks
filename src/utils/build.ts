import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as uglifyJS from 'uglify-js';
import * as CleanCSS from 'clean-css';
import * as sass from 'node-sass';

import Copy from './copy';

import {
  IBuildSettings,
  ICompileHbsTemplates, ICompileHbsTemplate,
  ICopyAssets, IMinifyContent,
  IConcatFilesContent, IBuildCustomCssFromScss
} from '../interfaces';

export default class Build {

  private settings: IBuildSettings;
  private copy: Copy;
  private EOL: string = '\n';

  constructor(settings: IBuildSettings = {}) {
    this.settings = {
      ...settings,
      src: settings.src || './src',
      dist: settings.dist || './dist',
      fileEncoding: settings.fileEncoding || 'utf-8'
    };
    this.copy = new Copy(this.settings);
  }

  public async buildBootstrap3(): Promise<string> {
    let compiledCss = '';
    const bootstrapRoot = path.join(process.cwd(), '/node_modules/bootstrap/less');
    if (fs.existsSync(bootstrapRoot)) {
      const bootstrapFiles = [
        // Core variables and mixins
        'variables',
        'mixins',

        // Reset and dependencies
        // "normalize", // Not-Compatible
        'print',
        'glyphicons',

        // Core CSS
        // "scaffolding", // Not-Compatible
        // "type", // Not-Compatible
        'code',
        'grid',
        'tables',
        'forms', // Fixes needed
        'buttons',

        // Components
        'component-animations',
        'dropdowns',
        'button-groups',
        'input-groups',
        'navs',
        'navbar',
        'breadcrumbs',
        'pagination',
        'pager',
        // 'labels',
        'badges',
        'jumbotron',
        'thumbnails',
        'alerts',
        'progress-bars',
        'media',
        'list-group',
        'panels',
        'responsive-embed',
        'wells',
        'close',

        // Components w/ JavaScript
        'modals',
        'tooltip',
        'popovers',
        'carousel',

        // Utility classes
        'utilities',
        'responsive-utilities',
        'theme'
      ];
      const bootstrapPaths = bootstrapFiles.map(fileName => {
        return path.join(bootstrapRoot, '/', fileName + '.less');
      });
      let content = await this.concatFilesContent({ filesArr: bootstrapPaths });
      content += `
        .row * {
          box-sizing: border-box;
        }
      `;

      let less = null;
      try {
        less = require('less');
      } catch (ex) {
        console.log('`npm i -D less` is required to build Bootstrap 3');
      }
      if (less) {
        const compileLess = (): Promise<string> => {
          return new Promise((resolve, reject) => {
            less.render(content, { filename: path.resolve(path.join(bootstrapRoot, '/_.less')) }, (err, output) => {
              if (err) {
                reject('Less compilation error:' + err.message);
              }
              const styles: string = output.css;
              resolve(styles);
            });
          });
        };
        compiledCss = await compileLess();
      }
    } else {
      console.log('No Bootstrap 3 installed found');
    }
    return compiledCss;
  }

  public buildCustomCssFromScss(params: IBuildCustomCssFromScss = {}): Promise<sass.Result> {
    return new Promise((resolve, reject) => {
      let { file, data, outputStyle, outFile, sourceMap, sourceMapContents } = params;
      data = data || file ? fs.readFileSync(file, this.settings.fileEncoding).toString() : null;
      outputStyle = outputStyle || 'compressed';
      // Files lock issue workaraund
      setTimeout(() => {
        sass.render({ file, data, outputStyle, outFile, sourceMap, sourceMapContents }, (err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result);
        });
      }, 50);
    });
  }

  public async concatFilesContent(params: IConcatFilesContent): Promise<string> {
    const { filesArr, distPath } = params;
    const concatedContent: string[] = [];
    for (const filePath of (filesArr || [])) {
      let content = '';
      if (filePath === 'bootstrap3') {
        content = await this.buildBootstrap3();
      } else {
        content = fs.readFileSync(filePath, this.settings.fileEncoding).toString();
      }
      concatedContent.push(content);
    }
    if (distPath) {
      mkdirp.sync(path.dirname(distPath));
      fs.writeFileSync(distPath, concatedContent.join(this.EOL), {
        encoding: this.settings.fileEncoding
      });
    }
    return concatedContent.join(this.EOL);
  }

  public minifyJsContent(params: IMinifyContent): uglifyJS.MinifyOutput {
    let { content, srcPath, distPath } = params;
    content = content || fs.readFileSync(srcPath, this.settings.fileEncoding);
    const minifiedContent = uglifyJS.minify(content, {
      compress: true,
      sourceMap: true,
      output: {
        comments: false
      },
      fromString: true
    } as uglifyJS.CompressOptions & any);
    if (distPath) {
      mkdirp.sync(path.dirname(distPath));
      fs.writeFileSync(distPath, minifiedContent.code, {
        encoding: this.settings.fileEncoding
      });
    }
    return minifiedContent;
  }

  public minifyCssContent(params: IMinifyContent): CleanCSS.Output {
    let { content, srcPath, distPath } = params;
    content = content || fs.readFileSync(srcPath, this.settings.fileEncoding);
    // level: { 1: { specialComments: 0 } }
    const minifiedContent = new CleanCSS({}).minify(content);
    if (distPath) {
      mkdirp.sync(path.dirname(distPath));
      fs.writeFileSync(distPath, minifiedContent.styles, {
        encoding: this.settings.fileEncoding
      });
    }
    return minifiedContent;
  }

  public copyAssets(params: ICopyAssets): void {
    const { srcArrayOrPath, dist } = params;
    mkdirp.sync(dist);
    if (Array.isArray(srcArrayOrPath)) {
      srcArrayOrPath.forEach(src => {
        this.copy.copyFileOrFolderSync(src, dist);
      });
    } else {
      this.copy.copyFileOrFolderSync(srcArrayOrPath, dist);
    }
  }

  public compileHbsTemplate(params: ICompileHbsTemplate): Promise<{ targetBody: string; targetPath: string; }> {
    return new Promise((resolve, reject) => {
      let { source, target, data } = params;
      const src = path.normalize(this.settings.src);
      const dist = path.normalize(this.settings.dist);
      source = path.normalize(source);
      target = path.normalize(target);
      if (source.indexOf(src) !== 0) {
        source = path.join(src, source);
      }
      if (target.indexOf(dist) !== 0) {
        target = path.join(dist, target);
      }
      const fileParse = path.parse(target);
      data = {
        ...data,
        fileName: `${fileParse.name}${fileParse.ext}`
      };
      fs.readFile(source, this.settings.fileEncoding, (err, sourceBody) => {
        if (err) {
          reject(err);
        }
        const template = Handlebars.compile(sourceBody.toString());
        const targetBody = template(data);
        mkdirp.sync(path.dirname(target));
        fs.writeFile(target, targetBody, {
          encoding: this.settings.fileEncoding
          // tslint:disable-next-line:no-shadowed-variable
        }, (err) => {
          if (err) {
            reject(err);
          }
          resolve({ targetBody, targetPath: target });
        });
      });
    });
  }

  public async compileHbsTemplates(params: ICompileHbsTemplates): Promise<{ targetBody: string; targetPath: string; }[]> {
    const { files, data } = params;
    const results: { targetBody: string; targetPath: string; }[] = [];
    for (const file of files) {
      const { source, target } = file;
      const result = await this.compileHbsTemplate({ source, target, data });
      results.push(result);
    }
    return results;
  }

}
