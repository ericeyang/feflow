import { PkgRelation } from './relation';
import fs from 'fs';
import { toInstalled } from './base';
import versionImpl from './version';
import path from 'path';

export class UniversalPkg {

    private pkgFile: string;

    private version: string = '0.0.0';

    // pkg: version
    private installed: Map<string, string> = new Map();

    private dependencies: Map<string, Map<string, PkgRelation>> = new Map();

    constructor(pkgFile: string) {
        this.pkgFile = pkgFile;
        if (!fs.existsSync(pkgFile)) {
            this.saveChange();
            return;
        }
        const universalPkg = require(pkgFile);
        this.version = universalPkg?.version || this.version;
        this.installed = toInstalled(universalPkg?.installed);
        this.dependencies = this.toDependencies(universalPkg?.dependencies);
    }

    private toDependencies(oDependencies: any): Map<string, Map<string, PkgRelation>> {
        let dependencies = new Map<string, Map<string, PkgRelation>>();
        if (!oDependencies) {
            return dependencies;
        }
        for (const pkg in oDependencies) {
            const versionRelationMap = oDependencies[pkg];
            if (!versionRelationMap) {
                continue;
            }
            let pkgRelation = new Map<string, PkgRelation>();
            for (const version in versionRelationMap) {
                const oVersionRelation = versionRelationMap[version];
                if (versionImpl.check(version)) {
                    pkgRelation.set(version, new PkgRelation(oVersionRelation));
                }
            }
            if (pkgRelation.size > 0) {
                dependencies.set(pkg, pkgRelation);
            }
        }
        return dependencies;
    }

    getInstalled(): Map<string, string> {
        return this.installed;
    }

    isInstalled(pkg: string, version?: string): boolean {
        const v = this.installed.get(pkg);
        if (v) {
            return version ? v === version : true;
        }
        return false;
    }

    isDepdenedOnOther(pkg: string, version: string): boolean {
        const vRelation = this.dependencies.get(pkg);
        if (vRelation) {
            const r = vRelation.get(version);
            if (r && r.dependedOn.size > 0) {
                return true;
            }
        }
        return false;
    }

    install(pkg: string, version: string) {
        this.installed.set(pkg, version);
    }

    depend(pkg: string, version: string, dependPkg: string, dependPkgVersion: string) {
        let versionMap = this.dependencies.get(pkg);
        if (!versionMap) {
            versionMap = new Map<string, PkgRelation>();
        }
        let r = versionMap.get(version);
        if (!r) {
            r = new PkgRelation(null);
        }
        r.dependencies.set(dependPkg, dependPkgVersion);
        versionMap.set(version, r);
        this.dependencies.set(pkg, versionMap);
        this.dependedOn(dependPkg, dependPkgVersion, pkg, version);
    }

    removeDepend(pkg: string, version: string, dependPkg: string, dependPkgVersion: string) {
        const dependencies = this.getDependencies(pkg, version);
        if (dependencies) {
            dependencies.delete(dependPkg);
        }
        const depended = this.getDepended(dependPkg, dependPkgVersion);
        if (depended) {
            depended.delete(pkg);
        }
        return depended ? depended.size : 0;
    }

    private dependedOn(pkg: string, version: string, dependedOnPkg: string, dependedOnPkgVersion: string) {
        let versionMap = this.dependencies.get(pkg);
        if (!versionMap) {
            versionMap = new Map<string, PkgRelation>();
        }
        let r = versionMap.get(version);
        if (!r) {
            r = new PkgRelation(null);
        }
        r.dependedOn.set(dependedOnPkg, dependedOnPkgVersion);
        versionMap.set(version, r);
        this.dependencies.set(pkg, versionMap);
    }

    uninstall(pkg: string, version: string, isDep?: boolean) {
        const depended = this.getDepended(pkg, version);
        if (depended && depended.size > 0) {
            if (isDep) {
                return;
            }
            throw `refusing to uninstall ${pkg}@${version} because it is required by
            ${depended?.keys[0]}@${depended?.values[0]} ...`;
        }
        const dependencies = this.getDependencies(pkg, version);
        if (dependencies) {
            for (const [requiredPkg, requiredVersion] of dependencies) {
                this.uninstall(requiredPkg, requiredVersion, true);
                this.removeDepended(requiredPkg, requiredVersion, pkg, version);
            }
        }
        if (!isDep && this.installed.get(pkg) === version) {
            this.installed.delete(pkg);
        }
        const versionRelation = this.dependencies.get(pkg);
        if (versionRelation) {
            const r = versionRelation.get(version);
            if (r) {
                versionRelation.delete(version);
            }
        }
        if (!isDep) {
            this.saveChange();
        }
    }

    private removeDepended(pkg: string, version: string, dependedPkg: string, dependedVersion: string) {
        const dependedOn = this.getDepended(pkg, version);
        if (!dependedOn) {
            return;
        }
        if (dependedOn.get(dependedPkg) === dependedVersion) {
            dependedOn.delete(dependedPkg);
        }
    }

    getDepended(pkg: string, version: string): Map<string, string> | undefined {
        const r = this.getPkgRelation(pkg, version);
        if (!r) {
            return;
        }
        return r.dependedOn;
    }

    getDependencies(pkg: string, version: string): Map<string, string> | undefined {
        const r = this.getPkgRelation(pkg, version);
        if (!r) {
            return;
        }
        return r.dependencies;
    }

    getPkgRelation(pkg: string, version: string): PkgRelation | undefined {
        const versionRelation = this.dependencies.get(pkg);
        if (!versionRelation) {
            return;
        }
        return versionRelation.get(version);
    }

    getAllDependencies(): Map<string, Map<string, PkgRelation>> {
        return this.dependencies;
    }

    saveChange() {
        if (!fs.existsSync(this.pkgFile)) {
            const d = path.resolve(this.pkgFile, '..');
            if (!fs.existsSync(d)) {
                fs.mkdirSync(d, {
                    recursive: true
                });
            }
        }
        fs.writeFileSync(this.pkgFile, JSON.stringify({
            version: this.version,
            installed: this.toObject(this.installed),
            dependencies: this.toObject(this.dependencies)
        }, null, 4))
    }

    private toObject(obj: any): object {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        let newObj = Object.create(null);
        if (obj instanceof Map) {
            for (let [k, v] of obj) {
                v = typeof v === 'object' ? this.toObject(v) : v;
                newObj[k] = v;
            }
        } else {
            for (const k in obj) {
                let v = obj[k];
                v = typeof v === 'object' ? this.toObject(v) : v;
                newObj[k] = v;
            }
        }
        return newObj;
    }

}
